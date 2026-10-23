package moe.rukamori.archivetune.desktop.server

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Deferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import moe.rukamori.archivetune.innertube.YouTube
import java.util.logging.Level

internal class VisitorDataCoordinator(
    private val fetchVisitorData: suspend () -> Result<String> = { YouTube.visitorData() },
    private val updateVisitorData: (String) -> Unit = { YouTube.visitorData = it },
    private val scope: CoroutineScope = CoroutineScope(Job() + Dispatchers.IO),
    private val retryDelay: suspend (Long) -> Unit = { delay(it) },
) {
    @Volatile
    private var initialized = false

    val isInitialized: Boolean
        get() = initialized

    private val stateLock = Any()
    private var inFlight: Deferred<Boolean>? = null
    private var retryJob: Job? = null
    private var stopped = false

    fun start() {
        synchronized(stateLock) {
            if (stopped || retryJob != null) return
            retryJob =
                scope.launch {
                    val delaysMs = longArrayOf(2_000, 5_000, 10_000)
                    for (attempt in 0..delaysMs.size) {
                        if (refresh("startup attempt ${attempt + 1}/${delaysMs.size + 1}")) return@launch
                        if (attempt < delaysMs.size) retryDelay(delaysMs[attempt])
                    }
                    DesktopServerLog.logger.severe(
                        "YouTube visitorData startup retries exhausted; next search or stream request will retry once",
                    )
                }
        }
    }

    suspend fun ensureAvailable(reason: String): Boolean {
        val shared =
            synchronized(stateLock) {
                if (initialized) return true
                if (stopped) return false
                getOrStartRefresh("lazy refresh for $reason")
            }
        return shared.await()
    }

    suspend fun refresh(reason: String): Boolean {
        val shared =
            synchronized(stateLock) {
                if (stopped) return false
                getOrStartRefresh(reason)
            }
        return shared.await()
    }

    fun stop() {
        synchronized(stateLock) {
            if (stopped) return
            stopped = true
            retryJob?.cancel()
            retryJob = null
            scope.cancel()
        }
    }

    private suspend fun cancelRetryJobIfDifferent() {
        val currentJob = currentCoroutineContext()[Job]
        val retry = synchronized(stateLock) { retryJob }
        if (retry != null && retry !== currentJob) {
            retry.cancel()
        }
    }

    private fun getOrStartRefresh(reason: String): Deferred<Boolean> =
        inFlight ?: scope.async {
            try {
                fetchVisitorData().fold(
                    onSuccess = { value ->
                        updateVisitorData(value)
                        initialized = true
                        DesktopServerLog.logger.info("Fetched YouTube visitorData for $reason")
                        cancelRetryJobIfDifferent()
                        true
                    },
                    onFailure = { failure ->
                        if (failure is CancellationException) throw failure
                        DesktopServerLog.logger.log(
                            Level.SEVERE,
                            "Failed to fetch YouTube visitorData for $reason",
                            failure,
                        )
                        false
                    },
                )
            } catch (cancellation: CancellationException) {
                throw cancellation
            } catch (failure: Exception) {
                DesktopServerLog.logger.log(
                    Level.SEVERE,
                    "Failed to fetch YouTube visitorData for $reason",
                    failure,
                )
                false
            }
        }.also { deferred ->
            inFlight = deferred
            deferred.invokeOnCompletion {
                synchronized(stateLock) {
                    if (inFlight === deferred) inFlight = null
                }
            }
        }
}
