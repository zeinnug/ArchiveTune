package moe.rukamori.archivetune.desktop.server

import org.junit.Assert.assertEquals
import org.junit.Test

class LrcParserTest {
    @Test
    fun parsesMultipleTimestampsOnOneLine() {
        assertEquals(
            listOf(
                TimedLyricLine(10_000, "Hello"),
                TimedLyricLine(12_000, "Hello"),
            ),
            LrcParser.parse("[00:10.00][00:12.00]Hello"),
        )
    }

    @Test
    fun parsesTwoAndThreeDigitFractions() {
        assertEquals(
            listOf(
                TimedLyricLine(10_230, "First"),
                TimedLyricLine(20_456, "Second"),
            ),
            LrcParser.parse("[00:10.23]First\n[00:20.456]Second"),
        )
    }

    @Test
    fun appliesOffsetToEveryTimestamp() {
        assertEquals(
            listOf(TimedLyricLine(10_500, "Line")),
            LrcParser.parse("[offset:500]\n[00:10.00]Line"),
        )
    }

    @Test
    fun ignoresMetadataTags() {
        assertEquals(
            listOf(TimedLyricLine(1_000, "Line")),
            LrcParser.parse("[ar:Artist]\n[ti:Title]\n[al:Album]\n[by:Editor]\n[length:01:00]\n[00:01.00]Line"),
        )
    }

    @Test
    fun preservesTimestampedBlankLines() {
        assertEquals(
            listOf(TimedLyricLine(1_000, ""), TimedLyricLine(2_000, "Next")),
            LrcParser.parse("[00:01.00]  \n[00:02.00]Next"),
        )
    }

    @Test
    fun sortsLinesByTimestamp() {
        assertEquals(
            listOf(TimedLyricLine(1_000, "Earlier"), TimedLyricLine(2_000, "Later")),
            LrcParser.parse("[00:02.00]Later\n[00:01.00]Earlier"),
        )
    }
}
