
import './styles/main.css'
import './styles/dashboard.css'

import './pages/dashboard.js'

import { handleSpotifyCallback } from './modules/spotify.js'

// Processa o retorno da autenticação Spotify, se houver.
async function initializeSpotifyAuth() {
  try {
    const connected = await handleSpotifyCallback()

    if (connected) {
      console.info('Spotify conectado com sucesso!')
      window.dispatchEvent(new CustomEvent('spotify-connected'))
    }
  } catch (error) {
    console.error('Erro ao conectar ao Spotify:', error)
    window.dispatchEvent(
      new CustomEvent('spotify-auth-error', {
        detail: { message: error.message },
      })
    )
  }
}

initializeSpotifyAuth()
