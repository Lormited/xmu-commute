package expo.modules.schoolreminderjob

import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.os.PersistableBundle
import com.facebook.react.ReactApplication
import com.facebook.react.ReactHost
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import java.util.UUID
import java.util.concurrent.CopyOnWriteArraySet
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.runInterruptible

class SchoolReminderJobService : JobService() {
  override fun onStartJob(params: JobParameters): Boolean {
    val generation = params.extras.getString(GENERATION) ?: return false
    val scheduled = scheduler(this).getPendingJob(JOB_ID)
    if (scheduled?.extras?.getString(GENERATION) != generation || current != null) return false
    val run = Run(this, params)
    current = run
    run.startWhenFree()
    return true
  }

  override fun onStopJob(params: JobParameters): Boolean {
    val run = current ?: return false
    if (run.service !== this || run.generation != params.extras.getString(GENERATION)) return false
    run.revoke()
    return !run.finished
  }

  override fun onDestroy() {
    current?.takeIf { it.service === this }?.let { run ->
      run.revoke()
      jobFinished(run.params, !run.finished)
    }
    super.onDestroy()
  }

  private class Run(val service: SchoolReminderJobService, val params: JobParameters) : HeadlessJsTaskEventListener {
    val generation = params.extras.getString(GENERATION)
    val token: String = UUID.randomUUID().toString()
    @Volatile var finished = false
    private var startup: Job? = null
    private var host: ReactHost? = null
    private var tasks: HeadlessJsTaskContext? = null
    private var taskId: Int? = null
    private val onHostDestroy: () -> Unit = {
      UiThreadUtil.runOnUiThread {
        if (executing === this) complete(abandon = true)
      }
    }

    fun startWhenFree() {
      if (executing != null || startup != null) return
      startup = CoroutineScope(Dispatchers.Main).launch {
        try {
          val reactHost = checkNotNull((service.application as ReactApplication).reactHost)
          val startupTask = reactHost.start()
          runInterruptible(Dispatchers.IO) {
            while (!startupTask.isCompleted()) startupTask.waitForCompletion()
            check(!startupTask.isCancelled() && !startupTask.isFaulted())
          }
          if (current !== this@Run) return@launch
          val context = checkNotNull(reactHost.currentReactContext)
          check(context.hasActiveReactInstance())
          val data = Arguments.createMap().apply { putString("token", token) }
          val config = HeadlessJsTaskConfig(TASK_NAME, data, 0, true)
          host = reactHost
          reactHost.addBeforeDestroyListener(onHostDestroy)
          check(reactHost.currentReactContext === context && context.hasActiveReactInstance())
          val headlessTasks = HeadlessJsTaskContext.getInstance(context)
          tasks = headlessTasks
          executing = this@Run
          headlessTasks.addTaskEventListener(this@Run)
          val previousIds = headlessTasks.activeTaskIds()
          try {
            taskId = headlessTasks.startTask(config)
          } catch (failure: Exception) {
            taskId = (headlessTasks.activeTaskIds() - previousIds).singleOrNull()
            throw failure
          }
        } catch (failure: Exception) {
          if (failure is CancellationException && current !== this@Run) throw failure
          complete(abandon = true)
        } finally {
          startup = null
        }
      }
    }

    fun revoke() {
      if (current !== this) return
      current = null
      startup?.cancel()
      if (executing === this && !finished) {
        stopListeners.forEach { listener -> runCatching { listener(token) } }
      }
    }

    private fun complete(abandon: Boolean = false) {
      val ownsJob = current === this
      if (ownsJob) {
        if (abandon) revoke() else current = null
      }
      host?.removeBeforeDestroyListener(onHostDestroy)
      tasks?.removeTaskEventListener(this)
      if (abandon) taskId?.let { tasks?.finishTask(it) }
      host = null
      tasks = null
      taskId = null
      if (executing === this) executing = null
      if (ownsJob) service.jobFinished(params, !finished)
      current?.startWhenFree()
    }

    private fun HeadlessJsTaskContext.activeTaskIds(): Set<Int> {
      val ids = mutableSetOf<Int>()
      val observer = object : HeadlessJsTaskEventListener {
        override fun onHeadlessJsTaskStart(taskId: Int) { ids.add(taskId) }
        override fun onHeadlessJsTaskFinish(taskId: Int) = Unit
      }
      addTaskEventListener(observer)
      removeTaskEventListener(observer)
      return ids
    }

    override fun onHeadlessJsTaskStart(taskId: Int) = Unit

    override fun onHeadlessJsTaskFinish(taskId: Int) {
      if (taskId == this.taskId) complete()
    }
  }

  companion object {
    private const val TASK_NAME = "SchoolReminderJob"
    private const val JOB_ID = 0x584D5509
    private const val GENERATION = "generation"
    @Volatile private var current: Run? = null
    private var executing: Run? = null
    internal val stopListeners = CopyOnWriteArraySet<(String) -> Unit>()

    internal fun isCurrent(token: String): Boolean {
      val run = current ?: return false
      return run.token == token && !run.finished
    }

    internal fun schedule(context: Context, at: Double) {
      enqueue(context, at)
      current?.revoke()
    }

    internal fun cancel(context: Context) {
      scheduler(context).cancel(JOB_ID)
      current?.revoke()
    }

    internal fun finish(token: String, nextAt: Double?) {
      val run = current?.takeIf { it.token == token && !it.finished } ?: return
      if (nextAt != null) enqueue(run.service, nextAt)
      run.finished = true
      if (nextAt != null) run.revoke()
    }

    private fun scheduler(context: Context): JobScheduler = checkNotNull(context.getSystemService(JobScheduler::class.java))

    private fun enqueue(context: Context, at: Double) {
      require(at in -8.64e15..8.64e15 && at % 1.0 == 0.0) { "Expected an absolute Unix timestamp in milliseconds" }
      val extras = PersistableBundle().apply { putString(GENERATION, UUID.randomUUID().toString()) }
      val job = JobInfo.Builder(JOB_ID, ComponentName(context, SchoolReminderJobService::class.java))
        .setPersisted(true)
        .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
        .setMinimumLatency((at.toLong() - System.currentTimeMillis()).coerceAtLeast(0L))
        .setExtras(extras)
        .build()
      check(scheduler(context).schedule(job) == JobScheduler.RESULT_SUCCESS) { "Could not schedule the reminder Job" }
    }
  }
}
