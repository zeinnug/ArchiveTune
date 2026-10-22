package moe.rukamori.archivetune.desktop.server

import io.ktor.client.plugins.ResponseException
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpStatusCode
import io.ktor.http.HttpMethod
import io.ktor.http.HttpHeaders
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationCallPipeline
import io.ktor.server.application.call
import io.ktor.server.application.install
import io.ktor.server.cio.CIO
import io.ktor.server.engine.embeddedServer
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.cors.routing.CORS
import io.ktor.server.response.respond
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.serialization.kotlinx.json.json
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import moe.rukamori.archivetune.innertube.NetworkGatekeeperControl
import moe.rukamori.archivetune.innertube.YouTube
import moe.rukamori.archivetune.innertube.models.SongItem
import moe.rukamori.archivetune.innertube.models.YouTubeLocale
import kotlinx.coroutines.CancellationException
import java.security.MessageDigest
import java.util.logging.Level

fun main() {
    runBlocking {
        // This unofficial fork intentionally disables the network gatekeeper.
        NetworkGatekeeperControl.allowConnections()
        YouTube.locale = YouTubeLocale(gl = "US", hl = "en")
        YouTube.visitorData()
            .onSuccess { visitorData -> YouTube.visitorData = visitorData }
            .onFailure { failure ->
                if (failure is CancellationException) throw failure
                DesktopServerLog.logger.log(Level.SEVERE, "Initial YouTube visitorData fetch failed", failure)
            }
        DesktopServerLog.logger.info("YouTube startup locale=${YouTube.locale}")

        val port =
            System.getenv("ARCHIVETUNE_PORT")
                ?.toIntOrNull()
                ?.takeIf { it in 1..65535 }
                ?: error("ARCHIVETUNE_PORT must be an integer between 1 and 65535")
        val token =
            System.getenv("ARCHIVETUNE_TOKEN")
                ?.takeIf { it.isNotBlank() }
                ?: error("ARCHIVETUNE_TOKEN must be set to a non-empty value")

        embeddedServer(
            factory = CIO,
            host = "127.0.0.1",
            port = port,
        ) {
            module(token)
        }.start(wait = true)
    }
}

private fun Application.module(token: String) {
    val streamProxy = StreamProxy(StreamResolver())

    install(ContentNegotiation) {
        json(Json { explicitNulls = true })
    }

    install(CORS) {
        allowHost("localhost:5173", schemes = listOf("http"))
        allowMethod(HttpMethod.Get)
        allowHeader(HttpHeaders.Range)
        exposeHeader(HttpHeaders.ContentRange)
        exposeHeader(HttpHeaders.AcceptRanges)
        exposeHeader(HttpHeaders.ContentLength)
        exposeHeader(HttpHeaders.ContentType)
    }

    intercept(ApplicationCallPipeline.Call) {
        val suppliedToken = call.request.queryParameters["t"]
        val authorized =
            suppliedToken != null &&
                MessageDigest.isEqual(
                    suppliedToken.toByteArray(Charsets.UTF_8),
                    token.toByteArray(Charsets.UTF_8),
                )
        if (!authorized) {
            call.respond(HttpStatusCode.Unauthorized, ErrorResponse("Unauthorized"))
            finish()
        }
    }

    routing {
        get("/health") {
            call.respond(HealthResponse(status = "ok"))
        }

        get("/search") {
            val query = call.request.queryParameters["q"]?.trim()
            if (query.isNullOrEmpty()) {
                call.respond(
                    HttpStatusCode.BadRequest,
                    ErrorResponse("Query parameter 'q' is required"),
                )
                return@get
            }

            val searchResult =
                YouTube.search(
                    query = query,
                    filter = YouTube.SearchFilter.FILTER_SONG,
                    useAccountContext = false,
                ).getOrElse { cause ->
                    val responseBody = cause.fullResponseBody()
                    DesktopServerLog.logger.log(
                        Level.SEVERE,
                        "YouTube Music search failed; locale=${YouTube.locale}; full upstream response body:\n$responseBody",
                        cause,
                    )
                    call.respond(
                        HttpStatusCode.BadGateway,
                        ErrorResponse("YouTube Music search failed"),
                    )
                    return@get
                }

            call.respond(searchResult.items.filterIsInstance<SongItem>().map(SongItem::toResponse))
        }

        get("/stream/{id}") {
            val videoId = call.parameters["id"]
            if (videoId == null || !VIDEO_ID_PATTERN.matches(videoId)) {
                call.respond(HttpStatusCode.BadRequest, ErrorResponse("videoId must match ^[A-Za-z0-9_-]{11}$"))
                return@get
            }
            streamProxy.proxy(call, videoId) {
                refreshVisitorData("stream request for $videoId")
            }
        }
    }
}

@Serializable
private data class HealthResponse(
    val status: String,
)

@Serializable
internal data class ErrorResponse(
    val error: String,
)

@Serializable
private data class SongResponse(
    val id: String,
    val title: String,
    val artists: List<String>,
    val album: String?,
    val durationSec: Int?,
    val thumbnail: String?,
    val explicit: Boolean,
)

private val VIDEO_ID_PATTERN = Regex("^[A-Za-z0-9_-]{11}$")

internal object DesktopServerLog {
    val logger: java.util.logging.Logger = java.util.logging.Logger.getLogger("ArchiveTuneDesktopServer")
}

private suspend fun Throwable.fullResponseBody(): String {
    val responseException = generateSequence(this) { it.cause }.filterIsInstance<ResponseException>().firstOrNull()
        ?: return message ?: toString()
    return try {
        responseException.response.bodyAsText()
    } catch (readFailure: Exception) {
        DesktopServerLog.logger.log(Level.SEVERE, "Failed to read full YouTube error response body", readFailure)
        "${responseException.message}; failed to read response body: ${readFailure.message}"
    }
}

private suspend fun refreshVisitorData(reason: String): Boolean =
    YouTube.visitorData()
        .onSuccess { visitorData ->
            YouTube.visitorData = visitorData
            DesktopServerLog.logger.info("Refreshed YouTube visitorData for $reason")
        }.onFailure { failure ->
            if (failure is CancellationException) throw failure
            DesktopServerLog.logger.log(Level.SEVERE, "Failed to refresh YouTube visitorData for $reason", failure)
        }.isSuccess

private fun SongItem.toResponse() =
    SongResponse(
        id = id,
        title = title,
        artists = artists.map { it.name },
        album = album?.name,
        durationSec = duration,
        thumbnail = thumbnail,
        explicit = explicit,
    )
