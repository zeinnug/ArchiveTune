package moe.rukamori.archivetune.desktop.server

import io.ktor.client.HttpClient
import io.ktor.client.engine.cio.CIO
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsChannel
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.server.application.ApplicationCall
import io.ktor.server.response.respond
import io.ktor.utils.io.ByteWriteChannel
import io.ktor.utils.io.copyTo
import kotlinx.coroutines.CancellationException
import moe.rukamori.archivetune.innertube.models.YouTubeClient
import java.util.logging.Level

internal class StreamProxy(
    private val resolver: StreamResolver,
    private val client: HttpClient = HttpClient(CIO),
) {
    private data class StreamAttempt(
        val stream: ResolvedStream,
        val response: HttpResponse,
    )

    suspend fun proxy(
        call: ApplicationCall,
        videoId: String,
        refreshVisitorData: suspend () -> Boolean,
    ) {
        val range = call.request.headers[HttpHeaders.Range]
        var attempt = requestUpstream(videoId, range)
        val firstResponse = attempt.getOrNull()?.response
        if (firstResponse == null || !firstResponse.status.isSuccessfulStreamStatus()) {
            firstResponse?.bodyAsChannel()?.cancel(CancellationException("Retrying stream after visitorData refresh"))
            refreshVisitorData()
            attempt = requestUpstream(videoId, range)
        }

        val streamAttempt =
            attempt.getOrElse { failure ->
                DesktopServerLog.logger.log(Level.SEVERE, "Unable to resolve audio stream for $videoId", failure)
                call.respond(
                    HttpStatusCode.BadGateway,
                    ErrorResponse("Stream resolution failed after visitorData refresh: ${failure.message}"),
                )
                return
            }
        val resolvedStream = streamAttempt.stream
        val upstream = streamAttempt.response

        if (!upstream.status.isSuccessfulStreamStatus()) {
            val status = upstream.status
            val responseExcerpt =
                try {
                    upstream.bodyAsText().take(MAX_ERROR_BODY_CHARS)
                } catch (failure: Exception) {
                    if (failure is CancellationException) throw failure
                    "Unable to read upstream response body: ${failure.message}"
                }
            val error =
                "Audio upstream returned HTTP ${status.value} ${status.description} after visitorData refresh: " +
                    responseExcerpt
            DesktopServerLog.logger.severe("Stream request for $videoId failed: $error")
            call.respond(
                HttpStatusCode.BadGateway,
                ErrorResponse(error),
            )
            return
        }

        val contentType =
            upstream.headers[HttpHeaders.ContentType]
                ?.let { runCatching { ContentType.parse(it) }.getOrNull() }
                ?: runCatching { ContentType.parse(resolvedStream.mimeType) }.getOrDefault(ContentType.parse("audio/mp4"))
        val contentRange = upstream.headers[HttpHeaders.ContentRange]
        val contentLength =
            upstream.headers[HttpHeaders.ContentLength]
                ?.toLongOrNull()
                ?: if (upstream.status == HttpStatusCode.OK) {
                    resolvedStream.contentLength
                } else {
                    contentRange?.let(CONTENT_RANGE_PATTERN::matchEntire)
                        ?.groupValues
                        ?.let { match -> match[2].toLong() - match[1].toLong() + 1 }
                }
        val status = upstream.status

        call.respond(
            object : OutgoingContent.WriteChannelContent() {
                override val status: HttpStatusCode = status
                override val contentType: ContentType = contentType
                override val contentLength: Long? = contentLength
                override val headers =
                    io.ktor.http.Headers.build {
                        append(HttpHeaders.AcceptRanges, upstream.headers[HttpHeaders.AcceptRanges] ?: "bytes")
                        contentRange?.let { append(HttpHeaders.ContentRange, it) }
                    }

                override suspend fun writeTo(channel: ByteWriteChannel) {
                    upstream.bodyAsChannel().copyTo(channel)
                }
            },
        )
    }

    private suspend fun requestUpstream(
        videoId: String,
        range: String?,
    ): Result<StreamAttempt> =
        try {
            val stream = resolver.resolve(videoId)
            val response =
                fetch(stream, range).getOrElse { failure ->
                    throw failure
                }
            if (response.status == HttpStatusCode.Forbidden) {
                resolver.invalidate(videoId, stream)
            }
            Result.success(StreamAttempt(stream, response))
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (failure: Exception) {
            Result.failure(failure)
        }

    private suspend fun fetch(
        stream: ResolvedStream,
        range: String?,
    ): Result<HttpResponse> =
        try {
            Result.success(
                client.get(stream.url) {
                    header(HttpHeaders.UserAgent, stream.client?.userAgent ?: YouTubeClient.USER_AGENT_WEB)
                    range?.let { header(HttpHeaders.Range, it) }
                },
            )
        } catch (cancellation: CancellationException) {
            throw cancellation
        } catch (failure: Exception) {
            Result.failure(failure)
        }

    private companion object {
        val CONTENT_RANGE_PATTERN = Regex("bytes (\\d+)-(\\d+)/\\d+")
        const val MAX_ERROR_BODY_CHARS = 1_000
    }
}

private fun HttpStatusCode.isSuccessfulStreamStatus(): Boolean =
    this == HttpStatusCode.OK || this == HttpStatusCode.PartialContent
