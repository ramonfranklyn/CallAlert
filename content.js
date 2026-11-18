// Indica se uma chamada foi confirmada e está sendo acompanhada.
let callActive = false;
// Guarda o intervalo responsável por alternar o título da página.
let blinkInterval = null;
// Mantém a instância do áudio enquanto o ring estiver tocando.
let ringtone = null;
let ringtoneReady = false;
let ringtonePending = false;
// Guarda o temporizador que limita a duração do ring.
let ringtoneTimer = null;
// Evita disparar o mesmo alerta várias vezes para a mesma chamada.
let confirmedCall = false;

// Duração máxima do alerta sonoro, em milissegundos.
const RING_DURATION_MS = 6000;
// Intervalo curto para reduzir o tempo de resposta quando o DOM não muda.
const CALL_POLL_INTERVAL_MS = 100;
let monitorInterval = null;
let logInterval = null;
let pageObserver = null;
let contextCheckInterval = null;
let contextReloadStarted = false;
let monitoringStarted = false;

function isExtensionContextValid() {
    try {
        if (!globalThis.chrome || !chrome.runtime) {
            return false;
        }
        const extensionId = chrome.runtime.id;
        return Boolean(extensionId);
    } catch (error) {
        return false;
    }
}

function safeSendMessage(message) {
    if (!isExtensionContextValid()) {
        stopInvalidatedContextTimers();
        return false;
    }

    try {
        chrome.runtime.sendMessage(message);
        return true;
    } catch (error) {
        stopInvalidatedContextTimers();
        return false;
    }
}

function safeGetExtensionUrl(path) {
    if (!isExtensionContextValid()) {
        return null;
    }

    try {
        return chrome.runtime.getURL(path);
    } catch (error) {
        stopInvalidatedContextTimers();
        return null;
    }
}

function stopInvalidatedContextTimers() {
    if (typeof stopRingtone === "function") {
        stopRingtone();
    }
    if (typeof stopBlink === "function") {
        stopBlink();
    }

    if (monitorInterval) {
        clearInterval(monitorInterval);
        monitorInterval = null;
    }
    if (logInterval) {
        clearInterval(logInterval);
        logInterval = null;
    }
    if (pageObserver) {
        pageObserver.disconnect();
        pageObserver = null;
    }
    if (contextCheckInterval) {
        clearInterval(contextCheckInterval);
        contextCheckInterval = null;
    }
}

// Título original da página, usado para restaurá-lo após o alerta.
let originalTitle = document.title;
const isLocalTestPage = ["localhost", "127.0.0.1"].includes(location.hostname);

function updateTestStatus(attribute, value) {
    if (isLocalTestPage && document.documentElement) {
        document.documentElement.dataset[attribute] = value;
    }
}

// Calcula quantos sinais visuais de chamada estão presentes na página.
function callScore() {

    // Começa a pontuação sem sinais detectados.
    let score = 0;

    // Verifica o texto que identifica uma chamada receptiva.
    if (
        document.body.innerText.includes(
            "Chamada Receptiva"
        )
    ) {
        score++;
    }

    // Verifica o indicador visual de ocupado do Olos.
    if (
        document.querySelector(
            ".Chip.--busy"
        )
    ) {
        score++;
    }

    // Verifica se a seção de dados da ligação está visível.
    if (
        document.body.innerText.includes(
            "Dados da Ligação"
        )
    ) {
        score++;
    }

    // Verifica se algum elemento forte informa que a chamada está falando.
    const talking = [
        ...document.querySelectorAll("strong")
    ].some(el =>
        el.textContent.trim()
            .toUpperCase() === "FALANDO"
    );

    if (talking) {
        score++;
    }

    // Retorna a quantidade de sinais encontrados.
    return score;
}

// Considera a chamada detectada quando pelo menos dois sinais estão presentes.
function callDetected() {
    return callScore() >= 2;
}

// Inicia a alternância do título para destacar visualmente a chamada.
function startBlink() {

    // Evita criar vários intervalos para o mesmo alerta.
    if (blinkInterval) {
        return;
    }

    // Alterna entre o título original e o título de nova ligação a cada segundo.
    blinkInterval = setInterval(() => {

        document.title =
            document.title === "☎ NOVA LIGAÇÃO"
                ? originalTitle
                : "☎ NOVA LIGAÇÃO";

    }, 1000);
}

// Interrompe a alternância do título e restaura o título original.
function stopBlink() {

    // Não há nada para interromper se o alerta visual não estiver ativo.
    if (!blinkInterval) {
        return;
    }

    clearInterval(blinkInterval);

    blinkInterval = null;

    document.title = originalTitle;
}

// Prepara o áudio antes da chegada da chamada para evitar o carregamento no disparo.
function prepareRingtone() {

    if (ringtone) {
        return;
    }

    const ringtoneUrl = safeGetExtensionUrl("ring.mp3");
    if (!ringtoneUrl) {
        return;
    }

    ringtone = new Audio();
    ringtone.preload = "auto";
    ringtone.loop = true;
    ringtone.volume = 0.6;
    ringtone.addEventListener("canplay", () => {
        ringtoneReady = true;
        updateTestStatus("callAlertAudio", "ready");

        if (ringtonePending) {
            ringtonePending = false;
            startRingtonePlayback();
        }
    }, { once: true });
    ringtone.addEventListener("error", () => {
        ringtonePending = false;
        updateTestStatus("callAlertAudio", "error");
        console.error("Falha ao carregar o áudio do alerta.", ringtone.error);
    }, { once: true });
    ringtone.src = ringtoneUrl;
    updateTestStatus("callAlertAudio", "loading");
    ringtone.load();
}

function startRingtonePlayback() {

    if (!ringtone || !ringtoneReady || !ringtone.paused) {
        return;
    }

    ringtone.currentTime = 0;

    // Inicia a reprodução e só começa a contar a duração quando o áudio tocar.
    ringtone.play()
        .then(() => {
            if (ringtone.paused) {
                return;
            }

            updateTestStatus("callAlertAudio", "playing");
            ringtoneTimer = setTimeout(() => {
                stopRingtone();
            }, RING_DURATION_MS);
        })
        .catch((error) => {
            updateTestStatus(
                "callAlertAudio",
                error.name === "NotAllowedError" ? "blocked" : "error"
            );
            console.error(error);
        });
}

// Inicia imediatamente se o áudio estiver pronto; caso contrário aguarda o preload.
function playRingtone() {

    if (ringtone && !ringtone.paused) {
        return;
    }

    prepareRingtone();
    if (!ringtone) {
        updateTestStatus("callAlertAudio", "error");
        return;
    }

    if (!ringtoneReady) {
        ringtonePending = true;
        updateTestStatus("callAlertAudio", "loading");
        return;
    }

    startRingtonePlayback();
}

// Para o áudio e libera os recursos associados ao ring.
function stopRingtone() {

    // Cancela o limite de tempo quando o ring termina antes dos 6 segundos.
    if (ringtoneTimer) {
        clearTimeout(ringtoneTimer);
        ringtoneTimer = null;
    }
    ringtonePending = false;

    // Não há áudio ativo para interromper.
    if (!ringtone) {
        updateTestStatus("callAlertAudio", "stopped");
        return;
    }

    // Pausa o áudio e volta para o início, preservando o pré-carregamento.
    ringtone.pause();
    ringtone.currentTime = 0;
    updateTestStatus("callAlertAudio", "stopped");
}

// Reúne as ações executadas quando uma nova chamada é confirmada.
function incomingCall() {

    // Dispara a criação da notificação imediatamente, sem aguardar o service worker.
    safeSendMessage({
        type: "incomingCall"
    });

    // Inicia o áudio em paralelo com a criação da notificação.
    playRingtone();

    // Inicia o alerta visual no título da página.
    startBlink();
}

// Encerra todos os alertas associados à chamada atual.
function callFinished() {

    stopRingtone();

    stopBlink();
}

// Recebe comandos enviados pelo ícone da extensão ou pela notificação.
if (isExtensionContextValid()) {
    try {
        chrome.runtime.onMessage.addListener((message) => {
            if (!isExtensionContextValid()) {
                stopInvalidatedContextTimers();
                return;
            }

            if (message.type === "stopRingtone") {
                callFinished();
            }
        });
    } catch (error) {
        stopInvalidatedContextTimers();
    }
}

// Verifica o estado da chamada e controla o início e o fim dos alertas.
function monitor() {

    if (!isExtensionContextValid()) {
        stopInvalidatedContextTimers();
        return;
    }

    // Lê os sinais atuais exibidos na interface do Olos.
    const detected = callDetected();

    if (detected) {

        // Dispara o alerta somente uma vez por chamada confirmada.
        if (!confirmedCall) {
            confirmedCall = true;
            callActive = true;

            incomingCall();
        }

    } else {

        // Permite que uma próxima chamada gere um novo alerta.
        confirmedCall = false;

        // Finaliza os alertas quando a chamada deixa de ser detectada.
        if (callActive) {

            callActive = false;

            callFinished();
        }
    }
}

function startMonitoring() {
    if (monitoringStarted) {
        return;
    }

    if (!document.body) {
        document.addEventListener("DOMContentLoaded", startMonitoring, {
            once: true
        });
        return;
    }

    monitoringStarted = true;
    originalTitle = document.title;
    updateTestStatus("callAlert", "ready");
    updateTestStatus(
        "callAlertAudio",
        ringtoneReady ? "ready" : "loading"
    );

    // Executa uma verificação periódica mesmo quando o DOM não muda.
    monitorInterval = setInterval(monitor, CALL_POLL_INTERVAL_MS);

    // Observa mudanças do DOM para reagir sem aguardar o próximo ciclo.
    pageObserver = new MutationObserver(monitor);
    pageObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
    });

    logInterval = setInterval(() => {
        console.log("Score:", callScore());
    }, 1000);
}

// Começa o preload na injeção do script, antes da página terminar de carregar.
prepareRingtone();

// Recarrega uma aba stale após atualização ou desativação da extensão.
contextCheckInterval = setInterval(() => {
    if (isExtensionContextValid() || contextReloadStarted) {
        return;
    }

    contextReloadStarted = true;
    stopInvalidatedContextTimers();
    window.location.reload();
}, 500);

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startMonitoring, {
        once: true
    });
} else {
    startMonitoring();
}