
const CLIENT_ID = "d19f491f9be4486aaa3210d1b762697f";
// Segue a origem atual: 127.0.0.1:5173 em desenvolvimento e o domínio HTTPS em produção.
// Cada valor precisa estar cadastrado nas "Redirect URIs" do app no painel do Spotify.
const REDIRECT_URI = `${window.location.origin}/callback`;

const SCOPES = [
  "streaming",
  "user-read-private",
  "user-read-email",
  "user-read-playback-state",
  "user-modify-playback-state",
];

const KEYS = {
  verifier: "spotify_code_verifier",
  state: "spotify_auth_state",
  access: "spotify_access_token",
  refresh: "spotify_refresh_token",
  expires: "spotify_token_expires_at",
};

let statusElement;
let buttonElement;
let infoElement;

let updateInterval;
let progressInterval;

let currentProgressMs = 0;
let durationMs = 0;
let playbackIsPlaying = false;
let progressTimestamp = Date.now();
let isSeeking = false;

let spotifyPlayer = null;
let spotifyDeviceId = null;
let spotifyPlayerReady = false;
let spotifySDKPromise = null;


// ========================================
// AUTENTICAÇÃO
// ========================================

function randomString(length = 64) {
  const bytes = crypto.getRandomValues(new Uint8Array(length));

  return Array.from(bytes, byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function createCodeChallenge(verifier) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier)
  );

  const bytes = new Uint8Array(digest);

  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function setStatus(message, isError = false) {
  if (!statusElement) return;

  statusElement.textContent = message;
  statusElement.dataset.state = isError ? "error" : "normal";
}

function setConnectedUI(connected) {
  if (!buttonElement || !infoElement) return;

  buttonElement.textContent = connected
    ? "Desconectar Spotify"
    : "Conectar Spotify";

  infoElement.textContent = connected
    ? "Conta conectada. Buscando sua música..."
    : "Conecte sua conta para começar.";

  setStatus(connected ? "Conta conectada" : "Não conectado");
}

async function requestToken(params) {
  const response = await fetch(
    "https://accounts.spotify.com/api/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error_description ||
      data.error ||
      "Não foi possível autenticar no Spotify."
    );
  }

  return data;
}

function saveTokens(data) {
  sessionStorage.setItem(KEYS.access, data.access_token);

  if (data.refresh_token) {
    sessionStorage.setItem(KEYS.refresh, data.refresh_token);
  }

  sessionStorage.setItem(
    KEYS.expires,
    String(Date.now() + data.expires_in * 1000)
  );
}

export async function connectSpotify() {
  if (!window.isSecureContext || !crypto.subtle) {
    throw new Error(
      "Abra o Dashboard por http://127.0.0.1:5173 para iniciar a autenticação local."
    );
  }

  const verifier = randomString();
  const challenge = await createCodeChallenge(verifier);
  const state = randomString(32);

  sessionStorage.setItem(KEYS.verifier, verifier);
  sessionStorage.setItem(KEYS.state, state);

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: SCOPES.join(" "),
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
  });

  window.location.assign(
    `https://accounts.spotify.com/authorize?${params}`
  );
}

export async function handleSpotifyCallback() {
  const url = new URL(window.location.href);

  if (url.pathname !== "/callback") {
    return false;
  }

  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const returnedState = url.searchParams.get("state");

  try {
    if (error) {
      throw new Error(`Autorização recusada pelo Spotify: ${error}`);
    }

    const savedState = sessionStorage.getItem(KEYS.state);
    const verifier = sessionStorage.getItem(KEYS.verifier);

    if (
      !code ||
      !savedState ||
      returnedState !== savedState ||
      !verifier
    ) {
      throw new Error(
        "Não foi possível validar o retorno. Tente conectar novamente."
      );
    }

    const tokens = await requestToken({
      client_id: CLIENT_ID,
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
    });

    saveTokens(tokens);

    return true;
  } finally {
    sessionStorage.removeItem(KEYS.verifier);
    sessionStorage.removeItem(KEYS.state);

    window.history.replaceState({}, document.title, "/");
  }
}

export async function getSpotifyAccessToken() {
  const token = sessionStorage.getItem(KEYS.access);
  const expiresAt = Number(
    sessionStorage.getItem(KEYS.expires) || 0
  );

  if (token && Date.now() < expiresAt - 60_000) {
    return token;
  }

  const refreshToken = sessionStorage.getItem(KEYS.refresh);

  if (!refreshToken) {
    return null;
  }

  const data = await requestToken({
    client_id: CLIENT_ID,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  saveTokens(data);

  return data.access_token;
}

// ========================================
// BARRA DE PROGRESSO
// ========================================

function formatarTempo(ms) {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function atualizarBarraProgresso() {
  const progressElement = document.querySelector("#spotify-progress");
  const currentTimeElement = document.querySelector(
    "#spotify-current-time"
  );
  const durationElement = document.querySelector(
    "#spotify-duration"
  );

  if (
    !progressElement ||
    !currentTimeElement ||
    !durationElement
  ) {
    return;
  }

  // Não alterar o indicador enquanto o usuário arrasta.
  if (isSeeking) {
    return;
  }

  const elapsed = playbackIsPlaying
    ? Date.now() - progressTimestamp
    : 0;

  const safeDuration = Math.max(0, durationMs);

  const position = Math.min(
    currentProgressMs + elapsed,
    safeDuration
  );

  progressElement.value = safeDuration > 0
    ? Math.round((position / safeDuration) * 1000)
    : 0;

  currentTimeElement.textContent = formatarTempo(position);
  durationElement.textContent = formatarTempo(safeDuration);
}

function zerarProgresso() {
  currentProgressMs = 0;
  durationMs = 0;
  playbackIsPlaying = false;
  progressTimestamp = Date.now();

  atualizarBarraProgresso();
}

function iniciarAtualizacaoProgresso() {
  if (progressInterval) {
    clearInterval(progressInterval);
  }

  progressInterval = setInterval(
    atualizarBarraProgresso,
    1000
  );
}

// ========================================
// MÚSICA ATUAL
// ========================================

async function atualizarMusicaAtual() {
  const trackElement = document.querySelector("#spotify-track");
  const artistElement = document.querySelector("#spotify-artist");
  const coverElement = document.querySelector("#spotify-cover");

  if (!trackElement || !artistElement || !coverElement) {
    return;
  }

  try {
    const token = await getSpotifyAccessToken();

    if (!token) {
      trackElement.textContent = "Sua música, seu ritmo";
      artistElement.textContent = "Conecte sua conta para começar.";
      coverElement.hidden = true;

      zerarProgresso();
      return;
    }

    const response = await fetch(
      "https://api.spotify.com/v1/me/player",
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    if (response.status === 204) {
      trackElement.textContent = "Nenhuma música em reprodução";
      artistElement.textContent =
        "Abra o Spotify e comece a ouvir algo.";

      coverElement.hidden = true;

      zerarProgresso();
      setStatus("Nenhuma reprodução ativa");

      return;
    }

    if (!response.ok) {
      throw new Error(
        `Erro ao consultar o Spotify: ${response.status}`
      );
    }

    const playback = await response.json();
    const item = playback.item;

    if (!item) {
      trackElement.textContent = "Nenhuma faixa disponível";
      artistElement.textContent =
        "Não foi possível identificar a música.";

      coverElement.hidden = true;

      zerarProgresso();
      return;
    }

    // Atualizar os dados de reprodução.
    playbackIsPlaying = playback.is_playing;
    currentProgressMs = playback.progress_ms || 0;
    durationMs = item.duration_ms || 0;
    progressTimestamp = Date.now();

    atualizarBarraProgresso();

    // Atualizar nome e artista.
    trackElement.textContent = item.name;

    artistElement.textContent = item.artists
      ? item.artists.map(artist => artist.name).join(", ")
      : item.show?.name || "Artista não identificado";

    // Atualizar capa.
    const coverUrl =
      item.album?.images?.[0]?.url ||
      item.images?.[0]?.url;

    if (coverUrl) {
      if (coverElement.src !== coverUrl) {
        coverElement.src = coverUrl;
      }

      coverElement.hidden = false;
    } else {
      coverElement.hidden = true;
    }

    setStatus(
      playback.is_playing
        ? "Reproduzindo agora"
        : "Reprodução pausada"
    );
  } catch (error) {
    console.error(
      "Erro ao carregar a música atual:",
      error
    );

    setStatus(
      "Não foi possível carregar a música.",
      true
    );
  }
}

// ========================================
// CONTROLES DE REPRODUÇÃO
// ========================================


async function controlarReproducao(acao) {
  try {
    if (!spotifyPlayer || !spotifyPlayerReady) {
      setStatus("O reprodutor da Dashboard ainda não está pronto.", true);
      return;
    }

    switch (acao) {
      case "play":
        await spotifyPlayer.resume();
        break;

      case "pause":
        await spotifyPlayer.pause();
        break;

      case "previous":
        await spotifyPlayer.previousTrack();
        break;

      case "next":
        await spotifyPlayer.nextTrack();
        break;

      default:
        return;
    }
  } catch (error) {
    console.error("Erro no controle do Spotify:", error);
    setStatus("Não foi possível controlar a reprodução.", true);
  }
}


async function alternarReproducao() {
  if (!spotifyPlayer || !spotifyPlayerReady) {
    setStatus("Aguarde o reprodutor da Dashboard ficar pronto.", true);
    return;
  }

  try {
    await spotifyPlayer.togglePlay();
  } catch (error) {
    console.error("Erro ao alternar reprodução:", error);
    setStatus("Não foi possível iniciar ou pausar a música.", true);
  }
}

// ========================================
// DESCONEXÃO
// ========================================

export function disconnectSpotify() {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = undefined;
  }

  Object.values(KEYS).forEach(key => {
    sessionStorage.removeItem(key);
  });

  setConnectedUI(false);

  const trackElement = document.querySelector("#spotify-track");
  const artistElement = document.querySelector("#spotify-artist");
  const coverElement = document.querySelector("#spotify-cover");

  if (trackElement) {
    trackElement.textContent = "Sua música, seu ritmo";
  }

  if (artistElement) {
    artistElement.textContent =
      "Conecte sua conta para começar.";
  }

  if (coverElement) {
    coverElement.hidden = true;
    coverElement.removeAttribute("src");
  }

  zerarProgresso();
}

// ========================================
// ESTADO DA CONEXÃO
// ========================================

export function isSpotifyConnected() {
  return Boolean(sessionStorage.getItem(KEYS.access));
}

// SDK

function carregarSpotifySDK() {
  if (window.Spotify) {
    return Promise.resolve();
  }

  if (spotifySDKPromise) {
    return spotifySDKPromise;
  }

  spotifySDKPromise = new Promise((resolve, reject) => {
    window.onSpotifyWebPlaybackSDKReady = resolve;

    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;

    script.onerror = () => {
      spotifySDKPromise = null;
      reject(new Error("Não foi possível carregar o Spotify Player SDK."));
    };

    document.head.appendChild(script);
  });

  return spotifySDKPromise;
}

async function iniciarReprodutorSpotify() {
  if (spotifyPlayer) {
    return;
  }

  try {
    setStatus("Preparando o reprodutor da Dashboard...");

    await carregarSpotifySDK();

    const token = await getSpotifyAccessToken();

    if (!token) {
      throw new Error("Conecte sua conta do Spotify primeiro.");
    }

    spotifyPlayer = new window.Spotify.Player({
      name: "Dashboard Pessoal",
      volume: 0.5,

      getOAuthToken: async callback => {
        try {
          const accessToken = await getSpotifyAccessToken();

          if (accessToken) {
            callback(accessToken);
          } else {
            setStatus("Sessão expirada. Reconecte o Spotify.", true);
          }
        } catch (error) {
          console.error("Erro ao renovar token:", error);
          setStatus("Não foi possível renovar a sessão.", true);
        }
      }
    });

    spotifyPlayer.addListener("ready", async ({ device_id }) => {
      spotifyDeviceId = device_id;
      spotifyPlayerReady = true;

      setStatus("Reprodutor da Dashboard pronto.");

      console.log("Spotify Player pronto:", device_id);

      await transferirReproducaoParaDashboard();
    });

    spotifyPlayer.addListener("not_ready", ({ device_id }) => {
      if (spotifyDeviceId === device_id) {
        spotifyPlayerReady = false;
      }

      setStatus("O reprodutor do navegador ficou indisponível.", true);
    });

    spotifyPlayer.addListener("player_state_changed", state => {
      if (!state) {
        return;
      }

      const track = state.track_window.current_track;

      playbackIsPlaying = !state.paused;
      currentProgressMs = state.position;
      durationMs = state.duration;
      progressTimestamp = Date.now();

      const trackElement = document.querySelector("#spotify-track");
      const artistElement = document.querySelector("#spotify-artist");
      const coverElement = document.querySelector("#spotify-cover");

      if (trackElement && track) {
        trackElement.textContent = track.name;
      }

      if (artistElement && track) {
        artistElement.textContent = track.artists
          .map(artist => artist.name)
          .join(", ");
      }

      if (coverElement && track?.album?.images?.length) {
        coverElement.src = track.album.images[0].url;
        coverElement.hidden = false;
      }

      atualizarBarraProgresso();

      setStatus(
        state.paused ? "Reprodução pausada" : "Reproduzindo na Dashboard"
      );
    });

    spotifyPlayer.addListener("initialization_error", ({ message }) => {
      console.error("Erro de inicialização:", message);
      setStatus("O navegador não conseguiu iniciar o reprodutor.", true);
    });

    spotifyPlayer.addListener("authentication_error", ({ message }) => {
      console.error("Erro de autenticação do player:", message);
      setStatus("Falha na autenticação do reprodutor.", true);
    });

    spotifyPlayer.addListener("account_error", ({ message }) => {
      console.error("Erro de conta:", message);
      setStatus("A conta não foi autorizada para reproduzir neste dispositivo.", true);
    });

    spotifyPlayer.addListener("playback_error", ({ message }) => {
      console.error("Erro de reprodução:", message);
      setStatus("Não foi possível reproduzir esta faixa.", true);
    });

    const conectado = await spotifyPlayer.connect();

    if (!conectado) {
      throw new Error("Não foi possível conectar o reprodutor.");
    }
  } catch (error) {
    console.error("Erro ao iniciar o Spotify Player:", error);
    setStatus(error.message || "Falha ao iniciar o reprodutor.", true);
  }
}

async function transferirReproducaoParaDashboard() {
  if (!spotifyDeviceId) {
    return;
  }

  try {
    const token = await getSpotifyAccessToken();

    const response = await fetch(
      "https://api.spotify.com/v1/me/player",
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          device_ids: [spotifyDeviceId],
          play: true
        })
      }
    );

    if (!response.ok) {
      throw new Error(
        `Não foi possível transferir a reprodução: ${response.status}`
      );
    }

    setStatus("Dashboard selecionada como dispositivo de reprodução.");
  } catch (error) {
    console.error("Erro ao transferir reprodução:", error);
    setStatus(
      "Reprodutor pronto. Não foi possível transferir a reprodução automaticamente.",
      true
    );
  }
}

// ========================================
// INICIALIZAÇÃO DO MÓDULO
// ========================================

export function iniciarSpotify() {
  buttonElement = document.querySelector("#spotify-button");
  infoElement = document.querySelector(".spotify-info span");
  statusElement = document.querySelector("#spotify-status");

  const previousButton = document.querySelector(
    "#spotify-previous"
  );

  const playPauseButton = document.querySelector(
    "#spotify-play-pause"
  );

  const nextButton = document.querySelector(
    "#spotify-next"
  );

  const progressElement = document.querySelector(
    "#spotify-progress"
  );

  if (!buttonElement || !infoElement) {
    console.error(
      "Não foi possível localizar o cartão do Spotify."
    );
    return;
  }

  setConnectedUI(isSpotifyConnected());

  // Conexão inicial.
  
if (isSpotifyConnected()) {
  atualizarMusicaAtual();
  iniciarReprodutorSpotify();

  if (updateInterval) {
    clearInterval(updateInterval);
  }

  updateInterval = setInterval(
    atualizarMusicaAtual,
    15000
  );
}

  iniciarAtualizacaoProgresso();

  // Conectar ou desconectar a conta.
  buttonElement.addEventListener("click", async () => {
    buttonElement.disabled = true;

    try {
      if (isSpotifyConnected()) {
        disconnectSpotify();
      } else {
        setStatus("Conectando à sua conta...");
        await connectSpotify();
      }
    } catch (error) {
      setStatus(error.message, true);
      console.error(error);
    } finally {
      buttonElement.disabled = false;
    }

    window.addEventListener("spotify-connected", () => {
  setConnectedUI(true);
  atualizarMusicaAtual();
  iniciarReprodutorSpotify();

  if (updateInterval) {
    clearInterval(updateInterval);
  }

  updateInterval = setInterval(
    atualizarMusicaAtual,
    15000
  );
});
  });

  // Música anterior.
  previousButton?.addEventListener("click", () => {
    controlarReproducao("previous");
  });

  // Reproduzir ou pausar.
  playPauseButton?.addEventListener("click", () => {
    alternarReproducao();
  });

  // Próxima música.
  nextButton?.addEventListener("click", () => {
    controlarReproducao("next");
  });

  // Marcar que o usuário começou a arrastar.
  progressElement?.addEventListener("pointerdown", () => {
    isSeeking = true;
  });

  // Atualizar o tempo visual durante o arraste.
  progressElement?.addEventListener("input", () => {
    isSeeking = true;

    if (durationMs <= 0) {
      return;
    }

    const currentTimeElement = document.querySelector(
      "#spotify-current-time"
    );

    const positionMs = Math.round(
      (Number(progressElement.value) / 1000) * durationMs
    );

    if (currentTimeElement) {
      currentTimeElement.textContent =
        formatarTempo(positionMs);
    }
  });

  // Enviar a posição final ao Spotify.
  progressElement?.addEventListener("change", async () => {
    if (durationMs <= 0) {
      isSeeking = false;
      atualizarBarraProgresso();
      return;
    }

    const positionMs = Math.round(
      (Number(progressElement.value) / 1000) * durationMs
    );

    try {
      const token = await getSpotifyAccessToken();

      if (!token) {
        throw new Error(
          "Conecte sua conta do Spotify primeiro."
        );
      }

      const response = await fetch(
        `https://api.spotify.com/v1/me/player/seek?position_ms=${positionMs}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error(
          `Não foi possível mudar a posição: ${response.status}`
        );
      }

      currentProgressMs = positionMs;
      progressTimestamp = Date.now();

      setTimeout(atualizarMusicaAtual, 800);
    } catch (error) {
      console.error(
        "Erro ao alterar posição da música:",
        error
      );

      setStatus(error.message, true);
      await atualizarMusicaAtual();
    } finally {
      isSeeking = false;
      atualizarBarraProgresso();
    }
  });

  // Cancelar o arraste sem deixar a barra congelada.
  progressElement?.addEventListener("pointercancel", () => {
    isSeeking = false;
    atualizarBarraProgresso();
  });

  // Autenticação concluída.
  window.addEventListener("spotify-connected", () => {
    setConnectedUI(true);
    atualizarMusicaAtual();

    if (updateInterval) {
      clearInterval(updateInterval);
    }

    updateInterval = setInterval(
      atualizarMusicaAtual,
      15000
    );
  });

  // Erro de autenticação.
  window.addEventListener("spotify-auth-error", event => {
    setConnectedUI(false);

    setStatus(
      event.detail?.message || "Falha na autenticação.",
      true
    );
  });
}
