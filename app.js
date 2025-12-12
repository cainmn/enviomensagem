//-----------------------------------------
// NÚMEROS BLOQUEADOS
//-----------------------------------------
const numerosBloqueados = new Set([
    "11945509645",
    "11945272040",
    "1136518801"
]);
function filtrarBloqueados(lista) {
    return lista.filter(n => !numerosBloqueados.has(n.replace(/\D/g, "")));
}

//-----------------------------------------
// LOG
//-----------------------------------------
function log(msg) {
    const box = document.getElementById("log");
    box.textContent += msg + "\n";
    box.scrollTop = box.scrollHeight;
}

//-----------------------------------------
// UTILS
//-----------------------------------------
function normalizarNumero(n) {
    n = n.replace(/\D/g, "");
    if (!n.startsWith("55")) n = "55" + n;
    return n;
}

async function extrairTextoPDF(file) {
    return new Promise(async (resolve) => {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument(arrayBuffer).promise;
        let texto = "";
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            texto += content.items.map(t => t.str).join(" ") + "\n";
        }
        resolve(texto);
    });
}

function extrairTelefones(texto) {
    const regex = /\(?\d{2}\)?\s?\d{4,5}[-\s]?\d{4}/g;
    const encontrados = new Set();
    (texto.match(regex) || []).forEach(t => {
        const s = t.replace(/\D/g, "");
        if (s.length >= 10 && s.length <= 12) encontrados.add(s);
    });
    return [...encontrados];
}

function extrairPlacas(texto) {
    const regex = /\b([A-Z]{3}\-?\d{4}|[A-Z]{3}\d[A-Z]\d{2})\b/gi;
    const placas = [...(texto.match(regex) || [])]
        .map(p => p.replace(/[^A-Za-z0-9]/g, "").toUpperCase());
    return placas;
}
//-----------------------------------------
// DRAG & DROP PARA PDFs
//-----------------------------------------
const dropArea = document.getElementById("dropArea");
const pdfInput = document.getElementById("pdfInput");

dropArea.addEventListener("click", () => pdfInput.click());

dropArea.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropArea.classList.add("dragover");
});

dropArea.addEventListener("dragleave", () => {
    dropArea.classList.remove("dragover");
});

dropArea.addEventListener("drop", (e) => {
    e.preventDefault();
    dropArea.classList.remove("dragover");

    const arquivos = e.dataTransfer.files;

    if (arquivos.length > 0) {
        // injeta os arquivos arrastados no input
        pdfInput.files = arquivos;
        log(`📁 ${arquivos.length} arquivo(s) adicionado(s) por arrastar.`);
    }
});

//-----------------------------------------
// VARIÁVEIS GLOBAIS
//-----------------------------------------
let whatsappWindow = null; // referência para reutilizar a mesma aba/janela do WhatsApp
function openWhatsAppTab(url) {
    try {
        // abre ou reutiliza uma aba com o nome 'whatsappWindow' (mesma aba reaproveitada)
        if (!whatsappWindow || whatsappWindow.closed) {
            whatsappWindow = window.open(url, "whatsappWindow");
        } else {
            // atualiza a aba existente
            whatsappWindow.location.href = url;
            whatsappWindow.focus();
        }
    } catch (e) {
        // fallback
        whatsappWindow = window.open(url, "whatsappWindow");
    }
}

//-----------------------------------------
// BOTÃO PROCESSAR PDFs
//-----------------------------------------
document.getElementById("btnProcessar").onclick = async () => {
    log("=== Iniciando leitura dos PDFs ===");

    const arquivos = document.getElementById("pdfInput").files;
    if (arquivos.length === 0) return alert("Selecione PDFs!");

    let dadosPreview = [];

    for (let file of arquivos) {
        const texto = await extrairTextoPDF(file);
        let nums = extrairTelefones(texto);
        let originais = [...nums];
        nums = filtrarBloqueados(nums);
        const placas = extrairPlacas(texto);

        dadosPreview.push({
            nome: file.name,
            telefones: nums,
            bloqueados: originais.filter(n => !nums.includes(n)),
            placas
        });
    }

    mostrarDashboard(dadosPreview);
};

//-----------------------------------------
// DASHBOARD
//-----------------------------------------
function mostrarDashboard(dados) {
    const dash = document.getElementById("dashboard");
    const content = document.getElementById("dashboardContent");

    dash.classList.remove("hidden");

    let html = "";

    dados.forEach((pdf, idx) => {
        html += `
            <div class="mb-4 border-b pb-2">
                <h3 class="font-bold text-lg text-blue-600">${idx + 1}. ${pdf.nome}</h3>
                <p><strong>Placas detectadas:</strong> ${pdf.placas.length ? pdf.placas.join(", ") : "Nenhuma"}</p>
                <p><strong>Números válidos:</strong> ${pdf.telefones.length ? pdf.telefones.join(", ") : "Nenhum"}</p>
                <p class="text-red-600"><strong>Números bloqueados:</strong> ${pdf.bloqueados.length ? pdf.bloqueados.join(", ") : "Nenhum"}</p>
            </div>
        `;
    });

    content.innerHTML = html;

    document.getElementById("confirmarEnvio").onclick = () => iniciarEnvio(dados);
    document.getElementById("cancelarEnvio").onclick = () => {
        dash.classList.add("hidden");
        log("❌ Envio cancelado.");
    };
}

//-----------------------------------------
// INICIAR ENVIO — percorre PDFs e aguarda modal por PDF
//-----------------------------------------
async function iniciarEnvio(preview) {
    log("=== Iniciando envio das mensagens ===");

    const msgBase = document.getElementById("mensagem").value;
    const progressBar = document.getElementById("progressBar");

    let totalArquivos = preview.length;
    let atual = 0;

    for (let pdf of preview) {
        atual++;
        progressBar.style.width = `${(atual / totalArquivos) * 100}%`;

        log(`📄 Processando: ${pdf.nome}`);

        if (pdf.telefones.length === 0) {
            log("❌ Nenhum telefone válido.\n");
            continue;
        }

        if (pdf.placas.length === 0) {
            log("❌ Nenhuma placa detectada.\n");
            continue;
        }

        const placa = pdf.placas[0];
        const mensagem = encodeURIComponent(msgBase.replace("{placa}", placa));

        // mostra modal com nome do PDF e fila de telefones; aguarda até esvaziar ou usuário fechar
        await mostrarModalEnviar(pdf.nome, pdf.telefones.slice(), mensagem);

        log("-----------------------------------------------------\n");
    }

    log("🎉 PROCESSO CONCLUÍDO!");
}

//-----------------------------------------
// MODAL: mostra números e permite enviar um-a-um
// - mostra o nome do PDF atual
// - cards clicáveis (seleciona)
// - duplo clique no card envia direto
// - botao 'Pular número' remove sem enviar
// - envia usando mesma aba do WhatsApp (reuso de aba)
//-----------------------------------------
function mostrarModalEnviar(pdfName, telefones, mensagem) {
    return new Promise((resolve) => {
        const modal = document.getElementById("modalEnviar");
        const modalBox = document.getElementById("modalBox");
        const title = document.getElementById("modalTitle");
        const subtitle = document.getElementById("modalPdfName");
        const cardsContainer = document.getElementById("modalCards");
        const enviarBtn = document.getElementById("enviarNumero");
        const pularBtn = document.getElementById("pularNumero");
        const fecharBtn = document.getElementById("fecharModal");
        const info = document.getElementById("modalInfo");

        // estado local da fila e seleção
        const fila = Array.from(telefones);
        let selectedIndex = 0;

        title.textContent = "Enviar números";
        subtitle.textContent = pdfName;
        info.textContent = "Clique em um card para selecionar. Dê duplo-clique para enviar direto.";

        function renderCards() {
            cardsContainer.innerHTML = "";
            if (fila.length === 0) {
                cardsContainer.innerHTML = `<div class="text-gray-600">Nenhum número restante.</div>`;
                enviarBtn.disabled = true;
                pularBtn.disabled = true;
                return;
            }
            enviarBtn.disabled = false;
            pularBtn.disabled = false;

            fila.forEach((num, idx) => {
                const card = document.createElement("div");
                card.className = "modal-card";
                if (idx === selectedIndex) card.classList.add("selected");
                card.innerHTML = `
                    <div class="text-sm text-gray-500">${idx + 1}/${fila.length}</div>
                    <div class="text-base font-medium">${num}</div>
                `;
                // clique seleciona
                card.addEventListener("click", () => {
                    selectedIndex = idx;
                    renderCards();
                });
                // duplo clique envia direto esse número
                card.addEventListener("dblclick", async () => {
                    const numeroEscolhido = fila.splice(idx, 1)[0];
                    if (selectedIndex >= fila.length) selectedIndex = Math.max(0, fila.length - 1);
                    await enviarNumero(numeroEscolhido, mensagem);
                    renderCards();
                    // se acabou, resolve
                    if (fila.length === 0) {
                        closeModal();
                        resolve();
                    }
                });
                cardsContainer.appendChild(card);
            });
        }

        async function enviarNumero(numero, mensagemEnc) {
            const destino = normalizarNumero(numero);
            const url = `https://web.whatsapp.com/send?phone=${destino}&text=${mensagemEnc}`;
            openWhatsAppTab(url);
            log(`✔️ Enviado para ${destino}`);
            // dá um pequeno delay para dar tempo da aba carregar caso queira (não obrigatório)
            await new Promise(r => setTimeout(r, 300));
        }

        // enviar botão: envia o selecionado
        enviarBtn.onclick = async () => {
            if (fila.length === 0) return;
            const num = fila.splice(selectedIndex, 1)[0];
            if (selectedIndex >= fila.length) selectedIndex = Math.max(0, fila.length - 1);
            await enviarNumero(num, mensagem);
            renderCards();
            if (fila.length === 0) {
                closeModal();
                resolve();
            }
        };

        // pular botão: remove selecionado sem enviar
        pularBtn.onclick = () => {
            if (fila.length === 0) return;
            const skipped = fila.splice(selectedIndex, 1)[0];
            log(`⏭️ Pulou ${normalizarNumero(skipped)}`);
            if (selectedIndex >= fila.length) selectedIndex = Math.max(0, fila.length - 1);
            renderCards();
            if (fila.length === 0) {
                closeModal();
                resolve();
            }
        };

        // fechar modal (cancelar) -> resolve para continuar fluxo (vai para próximo PDF)
        fecharBtn.onclick = () => {
            log("❌ Modal fechado — prosseguindo para o próximo PDF.");
            closeModal();
            resolve();
        };

        function closeModal() {
            modal.classList.add("hidden");
            modal.classList.remove("show");
        }

        // abrir modal com animação
        modal.classList.remove("hidden");
        // permitir transição: adiciona classe 'show' que ativa styles em CSS
        setTimeout(() => modal.classList.add("show"), 10);

        // renderiza
        renderCards();
    });
}
