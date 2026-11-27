package io.github.mightyx3n.korie

import android.service.notification.NotificationListenerService

/**
 * Exists so the user can give Korie notification access, which Android requires before Korie may
 * read other apps' media sessions (what is playing, for the top-right corner). Korie reads no
 * notifications.
 */
class KorieNotifications : NotificationListenerService()
