import { useRegisterSW } from 'virtual:pwa-register/react'

// Shows a small toast when a new deployed version is available, letting the
// user reload on their terms (registerType: 'prompt').
export default function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div className="update-toast" role="status">
      <span className="update-toast-text">A new version is available.</span>
      <div className="update-toast-actions">
        <button
          type="button"
          className="update-toast-reload"
          onClick={() => updateServiceWorker(true)}
        >
          Reload
        </button>
        <button
          type="button"
          className="update-toast-dismiss"
          onClick={() => setNeedRefresh(false)}
        >
          Later
        </button>
      </div>
    </div>
  )
}
