package expo.modules.schoolreminderjob

import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SchoolReminderJobModule : Module() {
  private val stopListener: (String) -> Unit = { token -> sendEvent("onStop", mapOf("token" to token)) }

  override fun definition() = ModuleDefinition {
    Name("SchoolReminderJob")
    Events("onStop")

    OnCreate { SchoolReminderJobService.stopListeners.add(stopListener) }
    OnDestroy { SchoolReminderJobService.stopListeners.remove(stopListener) }

    AsyncFunction("schedule") { at: Double ->
      SchoolReminderJobService.schedule(checkNotNull(appContext.reactContext), at)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("cancel") {
      SchoolReminderJobService.cancel(checkNotNull(appContext.reactContext))
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("finish") { token: String, nextAt: Double? ->
      SchoolReminderJobService.finish(token, nextAt)
    }.runOnQueue(Queues.MAIN)

    Function("isCurrent") { token: String -> SchoolReminderJobService.isCurrent(token) }
  }
}
