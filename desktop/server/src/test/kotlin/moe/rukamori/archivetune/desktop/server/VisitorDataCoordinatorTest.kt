package moe.rukamori.archivetune.desktop.server

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.atomic.AtomicInteger

class VisitorDataCoordinatorTest {
    @Test
    fun concurrentLazyRefreshesShareOneFetch() = runBlocking {
        val fetchCount = AtomicInteger()
        val releaseFetch = CompletableDeferred<Unit>()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val coordinator =
            VisitorDataCoordinator(
                fetchVisitorData = {
                    fetchCount.incrementAndGet()
                    releaseFetch.await()
                    Result.success("visitor")
                },
                updateVisitorData = {},
                scope = scope,
            )

        try {
            val requests = List(12) { async(Dispatchers.Default) { coordinator.ensureAvailable("test") } }
            withTimeout(2_000) {
                while (fetchCount.get() == 0) kotlinx.coroutines.delay(1)
            }
            releaseFetch.complete(Unit)

            assertTrue(requests.awaitAll().all { it })
            assertEquals(1, fetchCount.get())
        } finally {
            coordinator.stop()
        }
    }

    @Test
    fun startupRetriesAreNonBlockingAndLazyRefreshWorksAfterExhaustion() = runBlocking {
        val fetchCount = AtomicInteger()
        val delays = CopyOnWriteArrayList<Long>()
        val fourthAttempt = CompletableDeferred<Unit>()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        val coordinator =
            VisitorDataCoordinator(
                fetchVisitorData = {
                    val attempt = fetchCount.incrementAndGet()
                    if (attempt == 4) fourthAttempt.complete(Unit)
                    if (attempt <= 4) {
                        Result.failure(IllegalStateException("offline"))
                    } else {
                        Result.success("visitor")
                    }
                },
                updateVisitorData = {},
                scope = scope,
                retryDelay = { delays += it },
            )

        try {
            coordinator.start()
            withTimeout(2_000) { fourthAttempt.await() }
            withTimeout(2_000) {
                while (delays.size < 3) kotlinx.coroutines.delay(1)
            }
            assertEquals(listOf(2_000L, 5_000L, 10_000L), delays)
            kotlinx.coroutines.delay(25)
            assertTrue(coordinator.ensureAvailable("after startup retries"))
            assertEquals(5, fetchCount.get())
        } finally {
            coordinator.stop()
        }
    }
}
