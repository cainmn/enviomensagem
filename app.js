//-----------------------------------------
// PDF.JS WORKER
//-----------------------------------------
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

//-----------------------------------------
// COMUNICAÇÃO COM IFRAME (SEGURO)
//-----------------------------------------
function atualizarIframeTabela() {
  const iframe = document.querySelector("#aba-tabelas iframe");
  if (iframe && iframe.contentWindow) {
    iframe.contentWindow.postMessage("reloadTabela", "*");
  }
}

//-----------------------------------------
// VERIFICA SE PDF JÁ FOI PROCESSADO
//-----------------------------------------
async function pdfJaProcessado(nomePdf) {
  try {
    const { data, error } = await supabase
      .from("veiculos")
      .select("id")
      .eq("pdf", nomePdf)
      .limit(1);

    if (error) throw error;
    return data.length > 0;
  } catch (err) {
    console.warn("⚠️ Falha ao verificar PDF, permitindo importação:", err);
    return false;
  }
}

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
// LOG VISUAL
//-----------------------------------------
function log(msg) {
  const box = document.getElementById("log");
  if (!box) return;
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

//-----------------------------------------
// PDF – EXTRAÇÃO POR POSIÇÃO
//-----------------------------------------
async function extrairItensPDF(file) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  let items = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    content.items.forEach(it => {
      items.push({
        text: it.str.trim(),
        x: it.transform[4],
        y: it.transform[5]
      });
    });
  }
  return items;
}

function extrairModeloPorPosicao(items) {
  const label = items.find(i => i.text === "MODELO");
  if (!label) return null;

  const candidatos = items.filter(i =>
    Math.abs(i.y - label.y) < 2 &&
    i.x > label.x &&
    i.text.length > 1 &&
    !/FIPE|CHASSI|COR|ANO/i.test(i.text)
  );

  candidatos.sort((a, b) => a.x - b.x);
  return candidatos[0]?.text || null;
}

function extrairCidadeOrigemPorPosicao(items) {
  const label = items.find(i => i.text === "CIDADE");
  if (!label) return null;

  const candidatos = items.filter(i =>
    Math.abs(i.y - label.y) < 2 &&
    i.x > label.x &&
    i.text.length > 2 &&
    !/BAIRRO|ESTADO|CEP/i.test(i.text)
  );

  candidatos.sort((a, b) => a.x - b.x);
  return candidatos[0]?.text || null;
}

//-----------------------------------------
// REGEX AUXILIARES
//-----------------------------------------
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
  const regex = /\b([A-Z]{3}\d[A-Z0-9]\d{2}|[A-Z]{3}\d{4})\b/gi;
  return [...(texto.match(regex) || [])]
    .map(p => p.replace(/[^A-Za-z0-9]/g, "").toUpperCase());
}

//-----------------------------------------
// DRAG & DROP (PDFs)
//-----------------------------------------
const dropArea = document.getElementById("dropArea");
const pdfInput = document.getElementById("pdfInput");

if (dropArea && pdfInput) {
  dropArea.onclick = () => pdfInput.click();

  dropArea.ondragover = e => {
    e.preventDefault();
    dropArea.classList.add("dragover");
  };

  dropArea.ondragleave = () => dropArea.classList.remove("dragover");

  dropArea.ondrop = e => {
    e.preventDefault();
    dropArea.classList.remove("dragover");
    pdfInput.files = e.dataTransfer.files;
    log(`📁 ${pdfInput.files.length} arquivo(s) adicionados`);
  };
}

//-----------------------------------------
// WHATSAPP
//-----------------------------------------
let whatsappWindow = null;

function openWhatsAppTab(url) {
  if (!whatsappWindow || whatsappWindow.closed) {
    whatsappWindow = window.open(url, "whatsappWindow");
  } else {
    whatsappWindow.location.href = url;
    whatsappWindow.focus();
  }
}

//-----------------------------------------
// PROCESSAR PDFs
//-----------------------------------------
document.getElementById("btnProcessar").onclick = async () => {
  log("=== Iniciando leitura dos PDFs ===");

  const arquivos = pdfInput.files;
  if (!arquivos.length) {
    alert("Selecione PDFs!");
    return;
  }

  let preview = [];

  for (let file of arquivos) {

    if (await pdfJaProcessado(file.name)) {
      log(`⚠️ PDF ignorado (já importado): ${file.name}`);
      continue;
    }

    log(`📄 Processando ${file.name}`);

    const items = await extrairItensPDF(file);
    const textoPlano = items.map(i => i.text).join(" ");

    const placas = extrairPlacas(textoPlano);
    if (!placas.length) {
      log(`⚠️ Nenhuma placa encontrada em ${file.name}`);
      continue;
    }

    const telefones = filtrarBloqueados(extrairTelefones(textoPlano));
    const modelo = extrairModeloPorPosicao(items) || "Não informado";
    const origem = extrairCidadeOrigemPorPosicao(items) || "Não informada";

    const destino =
      textoPlano.match(/\b(Itaquaquecetuba|Pirapora|Porto Seguro)\s*-?\s*[A-Z]{2}/i)?.[0] ||
      "Não informado";

    const entregaRaw =
      textoPlano.match(/DATA LIMITE ENTREGA\s+(\d{2}\/\d{2}\/\d{4})/i)?.[1] ||
      textoPlano.match(/\b\d{2}\/\d{2}\/\d{4}\b(?!.*\b\d{2}\/\d{2}\/\d{4}\b)/)?.[0] ||
      null;

    const entrega = entregaRaw
      ? entregaRaw.split("/").reverse().join("-")
      : null;

    for (let placa of placas) {
      const { error } = await supabase
        .from("veiculos")
        .insert({
          placa,
          modelo,
          origem,
          destino,
          entrega,
          pdf: file.name,
          status: "coletar",
          liberacao: "pendente"
        });

      if (error) {
        console.error("Erro ao salvar veículo:", error);
        log(`❌ Erro ao salvar ${placa}`);
      } else {
        log(`✅ Veículo ${placa} salvo`);
      }
    }

    preview.push({
      nome: file.name,
      placas,
      telefones
    });
  }

  atualizarIframeTabela();
  mostrarDashboard(preview);
};

//-----------------------------------------
// DASHBOARD (PRÉ-VISUALIZAÇÃO)
//-----------------------------------------
function mostrarDashboard(dados) {
  const dash = document.getElementById("dashboard");
  const content = document.getElementById("dashboardContent");

  dash.classList.remove("hidden");

  content.innerHTML = dados.map((pdf, i) => `
    <div class="border-b mb-3 pb-2">
      <strong>${i + 1}. ${pdf.nome}</strong><br>
      Placas: ${pdf.placas.join(", ") || "Nenhuma"}<br>
      Telefones: ${pdf.telefones.join(", ") || "Nenhum"}
    </div>
  `).join("");

  document.getElementById("confirmarEnvio").onclick =
    () => iniciarEnvio(dados);

  document.getElementById("cancelarEnvio").onclick = () => {
    dash.classList.add("hidden");
    log("❌ Envio cancelado.");
  };
}

//-----------------------------------------
// ENVIO WHATSAPP
//-----------------------------------------
async function iniciarEnvio(preview) {
  const msgBase = document.getElementById("mensagem").value;
  const progressBar = document.getElementById("progressBar");

  let total = preview.length;
  let atual = 0;

  for (let pdf of preview) {
    atual++;
    progressBar.style.width = `${(atual / total) * 100}%`;

    if (!pdf.telefones.length || !pdf.placas.length) continue;

    const placa = pdf.placas[0];
    const mensagem = encodeURIComponent(
      msgBase.replace("{placa}", placa)
    );

    await mostrarModalEnviar(pdf.nome, pdf.telefones.slice(), mensagem);
  }

  log("🎉 PROCESSO CONCLUÍDO!");
}

//-----------------------------------------
// MODAL WHATSAPP
//-----------------------------------------
function mostrarModalEnviar(pdfName, telefones, mensagem) {
  return new Promise(resolve => {
    const modal = document.getElementById("modalEnviar");
    const cards = document.getElementById("modalCards");
    const enviarBtn = document.getElementById("enviarNumero");
    const pularBtn = document.getElementById("pularNumero");
    const fecharBtn = document.getElementById("fecharModal");

    let fila = [...telefones];
    let idx = 0;

    document.getElementById("modalPdfName").textContent = pdfName;
    modal.classList.add("show");

    function render() {
      cards.innerHTML = "";
      fila.forEach((n, i) => {
        const d = document.createElement("div");
        d.className = "modal-card" + (i === idx ? " selected" : "");
        d.textContent = n;
        d.onclick = () => { idx = i; render(); };
        d.ondblclick = () => enviar();
        cards.appendChild(d);
      });
    }

    async function enviar() {
      const num = fila.splice(idx, 1)[0];
      if (!num) return;
      const url = `https://web.whatsapp.com/send?phone=${normalizarNumero(num)}&text=${mensagem}`;
      openWhatsAppTab(url);
      render();
      if (!fila.length) fechar();
    }

    function fechar() {
      modal.classList.remove("show");
      resolve();
    }

    enviarBtn.onclick = enviar;
    pularBtn.onclick = () => { fila.splice(idx, 1); render(); };
    fecharBtn.onclick = fechar;

    render();
  });
}


