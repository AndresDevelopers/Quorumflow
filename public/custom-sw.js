// Custom Service Worker for handling push notifications
// This extends the auto-generated service worker from next-pwa

const APP_NAME = '<%= APP_NAME %>';
const APP_NOTIFICATION_TAG = '<%= APP_NOTIFICATION_TAG %>';

self.addEventListener('push', function(event) {
  console.log('[Service Worker] Push Received.');
  
  if (!event.data) {
    console.log('[Service Worker] Push event but no data');
    return;
  }

  let data;
  try {
    data = event.data.json();
  } catch (e) {
    console.error('[Service Worker] Error parsing push data:', e);
    data = {
      title: 'Nueva Notificación',
      body: event.data.text(),
      icon: '/icono-app.png',
      badge: '/icono-app.png',
    };
  }

  const title = data.title || APP_NAME;
  const options = {
    body: data.body || 'Tienes una nueva notificación',
    icon: data.icon || '/icono-app.png',
    badge: data.badge || '/icono-app.png',
    data: {
      url: data.url || '/',
      timestamp: data.timestamp || Date.now(),
    },
    vibrate: [200, 100, 200],
    tag: APP_NOTIFICATION_TAG,
    requireInteraction: true,
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

self.addEventListener('notificationclick', function(event) {
  console.log('[Service Worker] Notification click received.');
  
  event.notification.close();

  const urlToOpen = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({
      type: 'window',
      includeUncontrolled: true
    }).then(function(clientList) {
      // Check if there's already a window open
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url === urlToOpen && 'focus' in client) {
          return client.focus();
        }
      }
      // If no window is open, open a new one
      if (clients.openWindow) {
        return clients.openWindow(urlToOpen);
      }
    })
  );
});

self.addEventListener('notificationclose', function(event) {
  console.log('[Service Worker] Notification closed', event);
});
