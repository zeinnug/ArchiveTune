package moe.rukamori.archivetune.desktop.server

import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.cio.CIO
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.parameter
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlin.math.abs

@Serializable
internal data class LyricsResponse(
    val synced: List<TimedLyricLine>?,
    val plain: String?,
    val source: String,
)

@Serializable
private data class LrcLibTrack(
    val trackName: String? = null,
    val artistName: String? = null,
    val duration: Double? = null,
    val plainLyrics: String? = null,
    val syncedLyrics: String? = null,
)

internal class LyricsService(
    private val client: HttpClient = createLyricsClient(),
    private val cache: LyricsCache = LyricsCache(),
) {
    suspend fun getLyrics(
        title: String,
        artist: String,
        album: String?,
        durationSec: Int?,
    ): LyricsResponse? {
        val key = listOf(title, artist, album.orEmpty(), durationSec?.toString().orEmpty())
            .joinToString("\u0000") { it.trim().lowercase() }
        val cached = cache.lookup(key)
        if (cached.found) return cached.value

        val track =
            if (durationSec != null) {
                findExact(title, artist, album, durationSec) ?: findSearchMatch(
                    cleanTitle(title),
                    artist,
                    durationSec,
                )
            } else {
                findSearchMatch(cleanTitle(title), artist, null)
            }

        val syncedText = track?.syncedLyrics?.takeIf(String::isNotBlank)
        val plainText = track?.plainLyrics?.takeIf(String::isNotBlank)
        val parsed = syncedText?.let(LrcParser::parse)?.takeIf(List<TimedLyricLine>::isNotEmpty)
        val result =
            if (parsed != null || plainText != null) {
                LyricsResponse(
                    synced = parsed,
                    plain = plainText,
                    source = SOURCE,
                )
            } else {
                null
            }
        cache.put(key, result)
        return result
    }

    private suspend fun findExact(
        title: String,
        artist: String,
        album: String?,
        durationSec: Int,
    ): LrcLibTrack? {
        val response =
            client.get("$LRCLIB_BASE_URL/api/get") {
                parameter("track_name", title)
                parameter("artist_name", artist)
                parameter("album_name", album.orEmpty())
                parameter("duration", durationSec)
            }
        return when (response.status) {
            HttpStatusCode.OK -> response.body<LrcLibTrack>()
            HttpStatusCode.NotFound -> null
            else -> throw IllegalStateException(
                "LRCLIB /api/get returned HTTP ${response.status.value}: ${response.bodyAsText().take(MAX_ERROR_CHARS)}",
            )
        }
    }

    private suspend fun findSearchMatch(
        title: String,
        artist: String,
        durationSec: Int?,
    ): LrcLibTrack? {
        val response =
            client.get("$LRCLIB_BASE_URL/api/search") {
                parameter("track_name", title)
                parameter("artist_name", artist)
            }
        if (response.status == HttpStatusCode.NotFound) return null
        if (response.status != HttpStatusCode.OK) {
            throw IllegalStateException(
                "LRCLIB /api/search returned HTTP ${response.status.value}: ${response.bodyAsText().take(MAX_ERROR_CHARS)}",
            )
        }

        val candidates = response.body<List<LrcLibTrack>>()
            .filter { track ->
                !track.syncedLyrics.isNullOrBlank() || !track.plainLyrics.isNullOrBlank()
            }
        if (durationSec == null) return candidates.firstOrNull()

        return candidates
            .filter { it.duration != null }
            .minByOrNull { abs(it.duration!! - durationSec) }
            ?.takeIf { candidate -> abs(candidate.duration!! - durationSec) <= DURATION_TOLERANCE_SECONDS }
    }

    private fun cleanTitle(title: String): String =
        title
            .replace(FEATURED_ARTIST_PATTERN, "")
            .replace(OFFICIAL_EXTRA_PATTERN, "")
            .replace(REMASTERED_SUFFIX_PATTERN, "")
            .trim()
            .ifBlank { title }

}

private const val DURATION_TOLERANCE_SECONDS = 2
private const val LRCLIB_BASE_URL = "https://lrclib.net"
private const val MAX_ERROR_CHARS = 500
private const val SOURCE = "lrclib"

private val FEATURED_ARTIST_PATTERN = Regex("""(?i)\s*[\[(]\s*(?:feat\.?|featuring)\s+[^)\]]*[\])]\s*""")
private val OFFICIAL_EXTRA_PATTERN =
    Regex(
        """(?i)\s*[\[(](?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|visuali[sz]er)[^\])]*[\])]\s*|\s*-\s*(?:official\s+)?(?:music\s+)?(?:video|audio|lyrics?|visuali[sz]er)\s*$""",
    )
private val REMASTERED_SUFFIX_PATTERN =
    Regex("""(?i)\s*[-–—]\s*(?:(?:19|20)\d{2}\s+)?remaster(?:ed)?(?:\s+\d{4})?.*$""")

private fun createLyricsClient(): HttpClient =
    HttpClient(CIO) {
        install(ContentNegotiation) {
            json(Json { ignoreUnknownKeys = true })
        }
        install(HttpTimeout) {
            requestTimeoutMillis = 15_000
            connectTimeoutMillis = 10_000
            socketTimeoutMillis = 15_000
        }
        expectSuccess = false
        defaultRequest {
            header(
                HttpHeaders.UserAgent,
                "ArchiveTuneDesktop-fork/0.1 (unofficial)",
            )
        }
    }

internal class LyricsCache(
    private val maximumSize: Int = 200,
) {
    private val entries = object : LinkedHashMap<String, LyricsResponse?>(maximumSize, 0.75f, true) {}

    data class Lookup(
        val found: Boolean,
        val value: LyricsResponse?,
    )

    @Synchronized
    fun lookup(key: String): Lookup =
        if (entries.containsKey(key)) {
            Lookup(found = true, value = entries[key])
        } else {
            Lookup(found = false, value = null)
        }

    @Synchronized
    fun put(
        key: String,
        value: LyricsResponse?,
    ) {
        entries[key] = value
        if (entries.size > maximumSize) {
            val eldestKey = entries.entries.iterator().next().key
            entries.remove(eldestKey)
        }
    }

    @Synchronized
    fun size(): Int = entries.size
}
