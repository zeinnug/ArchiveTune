package moe.rukamori.archivetune.desktop.server

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import moe.rukamori.archivetune.innertube.NewPipeUtils
import moe.rukamori.archivetune.innertube.YouTube
import moe.rukamori.archivetune.innertube.models.YouTubeClient
import moe.rukamori.archivetune.innertube.models.response.PlayerResponse
import java.io.InputStream
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.ConcurrentHashMap

internal data class ResolvedStream(
    val url: String,
    val client: YouTubeClient?,
    val mimeType: String,
    val contentLength: Long?,
)

internal class StreamResolutionException(message: String) : Exception(message)

internal class StreamResolver {
    private data class CachedStream(
        val stream: ResolvedStream,
        val expiresAtNanos: Long,
    )

    private val cache = ConcurrentHashMap<String, CachedStream>()

    suspend fun resolve(videoId: String): ResolvedStream {
        if (!VIDEO_ID_PATTERN.matches(videoId)) {
            throw StreamResolutionException("Invalid YouTube video ID")
        }

        val now = System.nanoTime()
        cache[videoId]?.let { cached ->
            if (now < cached.expiresAtNanos) return cached.stream
            cache.remove(videoId, cached)
        }

        val failures = mutableListOf<String>()
        val ytDlpResult =
            try {
                resolveWithYtDlp(videoId)
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (failure: Exception) {
                failures += "yt-dlp: ${failure.message}"
                null
            }
        if (ytDlpResult != null) {
            val resolved =
                ResolvedStream(
                    url = ytDlpResult,
                    client = null,
                    mimeType = "audio/mp4",
                    contentLength = null,
                )
            cache[videoId] = CachedStream(resolved, System.nanoTime() + CACHE_TTL_NANOS)
            return resolved
        }

        for (client in CLIENTS) {
            val signatureTimestamp =
                if (client.useSignatureTimestamp) {
                    NewPipeUtils.getSignatureTimestamp(videoId).getOrElse { failure ->
                        if (failure is CancellationException) throw failure
                        failures += "${client.clientName}: signature timestamp gagal (${failure.message})"
                        continue
                    }
                } else {
                    null
                }

            val playerResponse =
                YouTube.player(
                    videoId = videoId,
                    client = client,
                    signatureTimestamp = signatureTimestamp,
                    setLogin = false,
                ).getOrElse { failure ->
                    if (failure is CancellationException) throw failure
                    failures += "${client.clientName}: permintaan player gagal (${failure.message})"
                    continue
                }

            if (playerResponse.playabilityStatus.status != "OK") {
                val reason = playerResponse.playabilityStatus.reason?.takeIf(String::isNotBlank)
                failures +=
                    "${client.clientName}: status ${playerResponse.playabilityStatus.status}" +
                        (reason?.let { " ($it)" } ?: "")
                continue
            }

            val formats =
                playerResponse.streamingData
                    ?.adaptiveFormats
                    .orEmpty()
                    .filter { format ->
                        format.isAudio &&
                            (format.url != null || format.signatureCipher != null || format.cipher != null)
                    }
            val orderedFormats =
                formats.filter { it.mimeType.startsWith("audio/mp4", ignoreCase = true) }
                    .sortedByDescending { it.bitrate } +
                    formats.filterNot { it.mimeType.startsWith("audio/mp4", ignoreCase = true) }
                        .sortedByDescending { it.bitrate }

            if (orderedFormats.isEmpty()) {
                failures += "${client.clientName}: tidak ada format audio yang dapat diputar"
                continue
            }

            for (format in orderedFormats) {
                val streamUrl =
                    NewPipeUtils.getStreamUrl(format, videoId, client).getOrElse { failure ->
                        if (failure is CancellationException) throw failure
                        failures += "${client.clientName}: URL audio gagal di-resolve (${failure.message})"
                        continue
                    }
                val resolved =
                    ResolvedStream(
                        url = streamUrl,
                        client = client,
                        mimeType = format.mimeType.substringBefore(';').trim(),
                        contentLength = format.contentLength,
                    )
                cache[videoId] =
                    CachedStream(
                        stream = resolved,
                        expiresAtNanos = System.nanoTime() + CACHE_TTL_NANOS,
                    )
                return resolved
            }
        }

        throw StreamResolutionException(
            "Semua resolver gagal me-resolve stream untuk video $videoId: ${failures.joinToString("; ")}",
        )
    }

    private suspend fun resolveWithYtDlp(videoId: String): String =
        withContext(Dispatchers.IO) {
            val executable = System.getenv("ARCHIVETUNE_YTDLP")?.takeIf(String::isNotBlank) ?: "yt-dlp"
            val process =
                try {
                    ProcessBuilder(
                        executable,
                        "-g",
                        "-f",
                        "bestaudio[ext=m4a]/bestaudio",
                        "--no-playlist",
                        "--no-warnings",
                        "https://music.youtube.com/watch?v=$videoId",
                    ).start()
                } catch (failure: Exception) {
                    throw StreamResolutionException("yt-dlp gagal dijalankan: ${failure.message}; stderr: (kosong)")
                }

            val readers = Executors.newFixedThreadPool(2)
            val stdout = readers.submit<String?> { firstHttpsUrl(process.inputStream) }
            val stderr = readers.submit<String> { readBounded(process.errorStream, MAX_STDERR_CHARS) }
            try {
                val completed = process.waitFor(YTDLP_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                if (!completed) {
                    process.destroy()
                    if (!process.waitFor(1, TimeUnit.SECONDS)) {
                        process.destroyForcibly()
                        process.waitFor()
                    }
                    throw StreamResolutionException(
                        "yt-dlp timeout setelah ${YTDLP_TIMEOUT_SECONDS}s; stderr: ${stderr.get()}",
                    )
                }

                val outputUrl = stdout.get()
                val errorOutput = stderr.get()
                if (process.exitValue() != 0) {
                    throw StreamResolutionException(
                        "yt-dlp keluar dengan kode ${process.exitValue()}; stderr: ${errorOutput.ifBlank { "(kosong)" }}",
                    )
                }
                outputUrl
                    ?: throw StreamResolutionException(
                        "yt-dlp tidak mengeluarkan URL https; stderr: ${errorOutput.ifBlank { "(kosong)" }}",
                    )
            } catch (interrupted: InterruptedException) {
                process.destroyForcibly()
                Thread.currentThread().interrupt()
                throw CancellationException("yt-dlp process was interrupted", interrupted)
            } finally {
                if (process.isAlive) process.destroyForcibly()
                readers.shutdownNow()
            }
        }

    private fun firstHttpsUrl(input: InputStream): String? {
        var firstUrl: String? = null
        input.bufferedReader().useLines { lines ->
            lines.forEach { line ->
                if (firstUrl == null && line.startsWith("https://")) {
                    firstUrl = line
                }
            }
        }
        return firstUrl
    }

    private fun readBounded(input: InputStream, maximumChars: Int): String {
        val captured = StringBuilder(maximumChars)
        input.bufferedReader().use { reader ->
            val buffer = CharArray(1024)
            while (true) {
                val count = reader.read(buffer)
                if (count < 0) break
                val remaining = maximumChars - captured.length
                if (remaining > 0) captured.append(buffer, 0, minOf(count, remaining))
            }
        }
        return captured.toString()
    }

    fun invalidate(videoId: String, resolvedStream: ResolvedStream) {
        cache.computeIfPresent(videoId) { _, cached ->
            if (cached.stream == resolvedStream) null else cached
        }
    }

    private companion object {
        val VIDEO_ID_PATTERN = Regex("^[A-Za-z0-9_-]{11}$")
        val CLIENTS =
            listOf(
                YouTubeClient.ANDROID_VR_NO_AUTH,
                YouTubeClient.IOS,
                YouTubeClient.WEB_REMIX,
            )
        val CACHE_TTL_NANOS = TimeUnit.MINUTES.toNanos(15)
        const val YTDLP_TIMEOUT_SECONDS = 25L
        const val MAX_STDERR_CHARS = 500
    }
}
