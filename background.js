const INCOMING_CALL_NOTIFICATION_ID = "incoming-call";

let alertTabId = null;

function stopRingtoneInTab(tabId) {

    if (!tabId) {
        return;
    }

    chrome.tabs.sendMessage(tabId, {
        type: "stopRingtone"
    });
}

function showIncomingCallNotification(sender) {

    alertTabId = sender && sender.tab ? sender.tab.id : null;

    // Cria a notificação antes de qualquer consulta ou mudança de aba.
    chrome.notifications.create(INCOMING_CALL_NOTIFICATION_ID, {
        type: "basic",
        iconUrl: "icon.png",
        title: "Nova Ligação",
        message: "Você possui uma chamada receptiva.",
        priority: 2
    });

    // Procura todas as abas abertas para localizar o Olos.
    chrome.tabs.query({}, (tabs) => {

        // Seleciona a primeira aba pertencente ao sistema Olos.
        const olosTab = tabs.find(tab =>
            tab.url &&
            tab.url.includes("bbts.oloschannel.com.br")
        );

        // Não há ação de foco se o Olos não estiver aberto.
        if (!olosTab) {
            return;
        }

        chrome.tabs.update(olosTab.id, {
            active: true
        });

        chrome.windows.update(
            olosTab.windowId,
            {
                focused: true
            }
        );
    });
}

// Mantém o service worker conectado à página para evitar atraso de inicialização.
chrome.runtime.onConnect.addListener((port) => {

    if (port.name !== "call-alert") {
        return;
    }

    port.onMessage.addListener((message) => {
        if (message.type === "incomingCall") {
            showIncomingCallNotification(port.sender);
        }
    });
});

// Recebe mensagens do content script e coordena ações fora da página do Olos.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // Trata o alerta de uma nova chamada recebida.
    if (message.type === "incomingCall") {
        showIncomingCallNotification(sender);
        return;
    }

    // Encaminha um comando de parada para a aba ativa.
    if (message.type === "stopRingtone") {
        chrome.notifications.clear(INCOMING_CALL_NOTIFICATION_ID);
        alertTabId = null;

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            // Obtém a aba atualmente ativa na janela do navegador.
            const tab = tabs[0];

            // Encerra se não houver uma aba ativa disponível.
            if (!tab) {
                return;
            }

            // Pede ao content script que pare o áudio e o alerta visual.
            chrome.tabs.sendMessage(tab.id, {
                type: "stopRingtone"
            });
        });
    }

});

// O clique na notificação encerra o alerta na aba que detectou a chamada.
chrome.notifications.onClicked.addListener((notificationId) => {

    if (notificationId !== INCOMING_CALL_NOTIFICATION_ID) {
        return;
    }

    chrome.notifications.clear(notificationId);
    stopRingtoneInTab(alertTabId);

    if (alertTabId) {
        chrome.tabs.update(alertTabId, {
            active: true
        }, (tab) => {
            if (tab) {
                chrome.windows.update(tab.windowId, {
                    focused: true
                });
            }
        });
    }

    alertTabId = null;
});

// Usa o clique no ícone da extensão como interrupção manual do ring.
chrome.action.onClicked.addListener((tab) => {
    // Ignora cliques sem uma aba válida associada.
    if (!tab || !tab.id) {
        return;
    }

    chrome.notifications.clear(INCOMING_CALL_NOTIFICATION_ID);
    alertTabId = null;

    // Envia o comando de parada diretamente para a aba clicada.
    chrome.tabs.sendMessage(tab.id, {
        type: "stopRingtone"
    });
});

