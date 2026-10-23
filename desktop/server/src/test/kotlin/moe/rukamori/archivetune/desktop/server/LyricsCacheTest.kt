package moe.rukamori.archivetune.desktop.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class LyricsCacheTest {
    @Test
    fun evictsLeastRecentlyUsedEntryAndNeverExceedsCapacity() {
        val cache = LyricsCache()

        repeat(200) { index ->
            cache.put("track-$index", lyrics(index))
            assertTrue("cache exceeded 200 entries at insertion $index", cache.size() <= 200)
        }
        cache.lookup("track-0")
        cache.put("track-200", lyrics(200))

        assertEquals(200, cache.size())
        assertNotNull(cache.lookup("track-0").value)
        assertNull("track-1 should be the least recently used entry", cache.lookup("track-1").value)
        assertTrue(cache.lookup("track-200").found)
    }

    @Test
    fun cacheSupportsParallelReadsAndWrites() {
        val cache = LyricsCache()
        val executor = Executors.newFixedThreadPool(8)
        try {
            val tasks =
                (0 until 8).map { worker ->
                    executor.submit {
                        repeat(1_000) { iteration ->
                            val index = worker * 1_000 + iteration
                            val key = "track-$index"
                            cache.put(key, lyrics(index))
                            assertTrue(cache.size() <= 200)
                            cache.lookup(key)
                            cache.lookup("track-${(index + 1) % 8_000}")
                        }
                    }
                }
            tasks.forEach { it.get(30, TimeUnit.SECONDS) }
            assertTrue(cache.size() <= 200)
        } finally {
            executor.shutdownNow()
            assertTrue(executor.awaitTermination(5, TimeUnit.SECONDS))
        }
    }

    @Test
    fun remembersNotFoundValues() {
        val cache = LyricsCache()
        cache.put("missing", null)

        assertTrue(cache.lookup("missing").found)
        assertFalse(cache.lookup("missing").value != null)
    }

    private fun lyrics(index: Int) =
        LyricsResponse(
            synced = null,
            plain = "Lyrics $index",
            source = "test",
        )
}
