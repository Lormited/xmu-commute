package expo.modules.schoolreminderjob

import android.app.NotificationManager
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.notifications.notifications.model.Notification
import expo.modules.notifications.notifications.model.NotificationContent
import expo.modules.notifications.notifications.model.NotificationRequest
import expo.modules.notifications.notifications.presentation.builders.ExpoNotificationBuilder
import expo.modules.notifications.notifications.triggers.ChannelAwareTrigger
import expo.modules.notifications.service.delegates.SharedPreferencesNotificationCategoriesStore
import org.json.JSONObject

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

    (AsyncFunction("post") Coroutine { token: String, identifier: String, endAt: Double ->
      post(token, identifier, endAt)
    }).runOnQueue(Queues.MAIN)

    Function("isCurrent") { token: String -> SchoolReminderJobService.isCurrent(token) }
  }

  private suspend fun post(token: String, identifier: String, endAt: Double): Boolean {
    if (!endAt.isFinite() || !SchoolReminderJobService.isCurrent(token) || endAt <= System.currentTimeMillis()) return false
    val context = checkNotNull(appContext.reactContext)
    val manager = checkNotNull(context.getSystemService(NotificationManager::class.java))
    val content = NotificationContent.Builder()
      .setTitle("有新的签到活动")
      .setText("点按打开签到，由你确认提交")
      .setBody(JSONObject().put("source", "school"))
      .setAutoDismiss(true)
      .build()
    val request = NotificationRequest(identifier, content, ChannelAwareTrigger("school-attendance"))
    val notification = ExpoNotificationBuilder(context, Notification(request), SharedPreferencesNotificationCategoriesStore(context)).build()
    if (!SchoolReminderJobService.isCurrent(token) || endAt <= System.currentTimeMillis()) return false
    manager.notify(identifier, 0, notification)
    return true
  }
}
