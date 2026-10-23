package moe.rukamori.archivetune.desktop.server

import kotlinx.serialization.Serializable

@Serializable
internal data class TimedLyricLine(
    val timeMs: Long,
    val text: String,
)

internal object LrcParser {
    private val timestampPattern = Regex("""\[(\d+):(\d{2})(?:\.(\d{2,3}))?]""")
    private val offsetPattern = Regex("""(?i)\[offset:([+-]?\d+)]""")
    private val metadataPattern = Regex("""(?i)^\[(?:ar|ti|al|by|length|re|ve):.*]$""")

    fun parse(lrc: String): List<TimedLyricLine> {
        var offsetMs = 0L
        val parsedLines = mutableListOf<Pair<Int, TimedLyricLine>>()

        lrc.lineSequence().forEachIndexed { lineIndex, rawLine ->
            val line = rawLine.trimEnd('\r')
            offsetPattern.find(line)?.let { match ->
                offsetMs = match.groupValues[1].toLongOrNull() ?: 0L
            }
            if (metadataPattern.matches(line.trim())) return@forEachIndexed

            val timestamps = timestampPattern.findAll(line).toList()
            if (timestamps.isEmpty()) return@forEachIndexed

            val text = buildString {
                var cursor = 0
                timestamps.forEach { match ->
                    append(line, cursor, match.range.first)
                    cursor = match.range.last + 1
                }
                append(line, cursor, line.length)
            }.trim()

            timestamps.forEach { match ->
                val minutes = match.groupValues[1].toLongOrNull() ?: return@forEach
                val seconds = match.groupValues[2].toLongOrNull() ?: return@forEach
                val fraction = match.groupValues[3]
                val milliseconds =
                    when (fraction.length) {
                        2 -> fraction.toLongOrNull()?.times(10) ?: 0L
                        3 -> fraction.toLongOrNull() ?: 0L
                        else -> 0L
                    }
                val timeMs = (minutes * 60_000L) + (seconds * 1_000L) + milliseconds + offsetMs
                parsedLines += lineIndex to TimedLyricLine(timeMs.coerceAtLeast(0L), text)
            }
        }

        return parsedLines
            .sortedWith(compareBy<Pair<Int, TimedLyricLine>> { it.second.timeMs }.thenBy { it.first })
            .map { it.second }
    }
}
