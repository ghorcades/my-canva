// Lê input/ (PNGs, vídeos e ZIPs exportados do Canva) e gera dist/ pronto para abrir.
// Sem dependências: usa só módulos nativos do Node.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUT = path.join(RAIZ, 'input');
const DIST = path.join(RAIZ, 'dist');
const CACHE = path.join(RAIZ, '.cache', 'zip');
const PLAYER = path.join(RAIZ, 'src', 'player');
const CONFIG = path.join(RAIZ, 'player.config.json');

const IMAGENS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const VIDEOS = new Set(['.mp4', '.m4v', '.webm']);

const PADRAO = {
  titulo: 'Meu Canva',
  transicaoMs: 300,
  laser: true,
  laserOcultarMs: 2000,
  contador: false,
  loop: false,
  paginas: {},
};

const avisos = [];
const avisar = (msg) => avisos.push(msg);

// ---------- ZIP (leitura mínima: sem compressão e deflate, com suporte a ZIP64) ----------

function lerTrecho(fd, posicao, tamanho) {
  const buf = Buffer.alloc(tamanho);
  let lido = 0;
  while (lido < tamanho) {
    const n = fs.readSync(fd, buf, lido, tamanho - lido, posicao + lido);
    if (n === 0) throw new Error('arquivo ZIP truncado');
    lido += n;
  }
  return buf;
}

function listarZip(fd, tamanhoArquivo) {
  const tamCauda = Math.min(tamanhoArquivo, 22 + 65535);
  const inicioCauda = tamanhoArquivo - tamCauda;
  const cauda = lerTrecho(fd, inicioCauda, tamCauda);
  let i = cauda.length - 22;
  while (i >= 0 && cauda.readUInt32LE(i) !== 0x06054b50) i--;
  if (i < 0) throw new Error('não é um ZIP válido');

  let total = cauda.readUInt16LE(i + 10);
  let tamDir = cauda.readUInt32LE(i + 12);
  let posDir = cauda.readUInt32LE(i + 16);

  if (total === 0xffff || tamDir === 0xffffffff || posDir === 0xffffffff) {
    const loc = i - 20;
    if (loc < 0 || cauda.readUInt32LE(loc) !== 0x07064b50) throw new Error('ZIP64 inválido');
    const posFim64 = Number(cauda.readBigUInt64LE(loc + 8));
    const fim64 = lerTrecho(fd, posFim64, 56);
    if (fim64.readUInt32LE(0) !== 0x06064b50) throw new Error('ZIP64 inválido');
    total = Number(fim64.readBigUInt64LE(32));
    tamDir = Number(fim64.readBigUInt64LE(40));
    posDir = Number(fim64.readBigUInt64LE(48));
  }

  const dir = lerTrecho(fd, posDir, tamDir);
  const entradas = [];
  let p = 0;
  for (let n = 0; n < total; n++) {
    if (dir.readUInt32LE(p) !== 0x02014b50) throw new Error('diretório do ZIP corrompido');
    const flags = dir.readUInt16LE(p + 8);
    const metodo = dir.readUInt16LE(p + 10);
    let tamComp = dir.readUInt32LE(p + 20);
    let tamReal = dir.readUInt32LE(p + 24);
    const tamNome = dir.readUInt16LE(p + 28);
    const tamExtra = dir.readUInt16LE(p + 30);
    const tamComent = dir.readUInt16LE(p + 32);
    let posLocal = dir.readUInt32LE(p + 42);
    const nome = dir.toString('utf8', p + 46, p + 46 + tamNome);

    // Campo extra ZIP64: só traz os valores que estouraram 32 bits, nesta ordem.
    let e = p + 46 + tamNome;
    const fimExtra = e + tamExtra;
    while (e + 4 <= fimExtra) {
      const id = dir.readUInt16LE(e);
      const tam = dir.readUInt16LE(e + 2);
      if (id === 0x0001) {
        let q = e + 4;
        if (tamReal === 0xffffffff) { tamReal = Number(dir.readBigUInt64LE(q)); q += 8; }
        if (tamComp === 0xffffffff) { tamComp = Number(dir.readBigUInt64LE(q)); q += 8; }
        if (posLocal === 0xffffffff) { posLocal = Number(dir.readBigUInt64LE(q)); q += 8; }
      }
      e += 4 + tam;
    }

    entradas.push({ nome, flags, metodo, tamComp, tamReal, posLocal });
    p += 46 + tamNome + tamExtra + tamComent;
  }
  return entradas;
}

// Extrai em fluxo, sem carregar a entrada inteira na memória (vídeos podem passar de 2 GB).
async function extrairEntrada(zip, fd, entrada, destino) {
  if (entrada.flags & 1) throw new Error('ZIP protegido por senha não é suportado');
  if (entrada.metodo !== 0 && entrada.metodo !== 8) {
    throw new Error(`método de compressão ${entrada.metodo} não suportado`);
  }
  const cab = lerTrecho(fd, entrada.posLocal, 30);
  if (cab.readUInt32LE(0) !== 0x04034b50) throw new Error('entrada do ZIP corrompida');
  const inicio = entrada.posLocal + 30 + cab.readUInt16LE(26) + cab.readUInt16LE(28);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  if (entrada.tamComp === 0) {
    fs.writeFileSync(destino, '');
    return;
  }
  const etapas = [fs.createReadStream(zip, { start: inicio, end: inicio + entrada.tamComp - 1 })];
  if (entrada.metodo === 8) etapas.push(zlib.createInflateRaw());
  etapas.push(fs.createWriteStream(destino));
  await pipeline(etapas);
}

async function extrairZips(zips) {
  fs.rmSync(CACHE, { recursive: true, force: true });
  const extraidos = [];
  for (const [z, zip] of zips.entries()) {
    const fd = fs.openSync(zip, 'r');
    try {
      const entradas = listarZip(fd, fs.fstatSync(fd).size);
      let n = 0;
      for (const [i, entrada] of entradas.entries()) {
        if (entrada.nome.endsWith('/') || entrada.nome.startsWith('__MACOSX/')) continue;
        // Só o nome do arquivo é usado: caminhos dentro do ZIP nunca saem da pasta de cache.
        const base = path.basename(entrada.nome.replace(/\\/g, '/'));
        if (!base || base.startsWith('.')) continue;
        const ext = path.extname(base).toLowerCase();
        if (ext === '.mov') avisar(`${base} (dentro do ZIP): MOV não toca no Chrome; exporte em MP4.`);
        if (!IMAGENS.has(ext) && !VIDEOS.has(ext)) continue;
        const destino = path.join(CACHE, String(z), String(i), base);
        await extrairEntrada(zip, fd, entrada, destino);
        extraidos.push(destino);
        n++;
      }
      console.log(`  ZIP ${path.basename(zip)}: ${n} arquivo(s) extraído(s)`);
    } catch (erro) {
      throw new Error(`${path.basename(zip)}: ${erro.message}`);
    } finally {
      fs.closeSync(fd);
    }
  }
  return extraidos;
}

// ---------- Coleta dos arquivos ----------

function listarRecursivo(pasta) {
  const saida = [];
  if (!fs.existsSync(pasta)) return saida;
  for (const item of fs.readdirSync(pasta, { withFileTypes: true })) {
    if (item.name.startsWith('.')) continue;
    const caminho = path.join(pasta, item.name);
    if (item.isDirectory()) saida.push(...listarRecursivo(caminho));
    else if (item.isFile()) saida.push(caminho);
  }
  return saida.sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }));
}

// O número da página é o último grupo de dígitos do nome: 0003.png, 3.png, "Meu design - 3.png".
function numeroDaPagina(arquivo) {
  const nome = path.basename(arquivo, path.extname(arquivo));
  const achou = nome.match(/(\d+)(?!.*\d)/);
  return achou ? parseInt(achou[1], 10) : null;
}

function dimensoesPng(arquivo) {
  try {
    const fd = fs.openSync(arquivo, 'r');
    const cab = Buffer.alloc(24);
    fs.readSync(fd, cab, 0, 24, 0);
    fs.closeSync(fd);
    if (cab.readUInt32BE(0) !== 0x89504e47) return null;
    return { largura: cab.readUInt32BE(16), altura: cab.readUInt32BE(20) };
  } catch {
    return null;
  }
}

function lerConfig() {
  if (!fs.existsSync(CONFIG)) return { ...PADRAO };
  try {
    const lido = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
    // "3", "03" e "0003" são a mesma página.
    const paginas = {};
    for (const [chave, opcoes] of Object.entries(lido.paginas || {})) {
      const n = parseInt(chave, 10);
      if (!(n >= 1)) {
        avisar(`player.config.json: "${chave}" não é um número de página.`);
        continue;
      }
      paginas[n] = { ...(paginas[n] || {}), ...opcoes };
    }
    return { ...PADRAO, ...lido, paginas };
  } catch (erro) {
    throw new Error(`player.config.json inválido: ${erro.message}`);
  }
}

// ---------- Build ----------

async function build() {
  console.log('Meu Canva — build');
  fs.mkdirSync(INPUT, { recursive: true });

  const soltos = listarRecursivo(INPUT);
  const zips = soltos.filter((f) => path.extname(f).toLowerCase() === '.zip');
  const doZip = await extrairZips(zips);

  const paginas = new Map();
  const registrar = (arquivo, origem) => {
    const ext = path.extname(arquivo).toLowerCase();
    const tipo = IMAGENS.has(ext) ? 'imagem' : VIDEOS.has(ext) ? 'video' : null;
    const rel = path.relative(origem === 'zip' ? CACHE : INPUT, arquivo);
    if (!tipo) {
      if (ext === '.mov') avisar(`${rel}: MOV não toca no Chrome; exporte em MP4.`);
      else if (ext !== '.zip') avisar(`${rel}: tipo de arquivo ignorado.`);
      return;
    }
    const n = numeroDaPagina(arquivo);
    if (n === null || n < 1) {
      avisar(`${rel}: sem número de página no nome; arquivo ignorado.`);
      return;
    }
    if (!paginas.has(n)) paginas.set(n, {});
    const pagina = paginas.get(n);
    if (pagina[tipo]) {
      // Arquivo solto em input/ vence o que veio de dentro de um ZIP.
      if (pagina[tipo].origem === 'solto' && origem === 'zip') return;
      if (pagina[tipo].origem === origem) {
        avisar(`Página ${n}: mais de um arquivo de ${tipo}; usando ${rel}.`);
      }
    }
    pagina[tipo] = { arquivo, origem };
  };
  soltos.forEach((f) => registrar(f, 'solto'));
  doZip.forEach((f) => registrar(f, 'zip'));

  const config = lerConfig();
  const numeros = [...paginas.keys()].sort((a, b) => a - b);
  const casas = Math.max(4, String(numeros.at(-1) ?? 0).length);

  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(path.join(DIST, 'slides'), { recursive: true });

  const slides = [];
  const tamanhos = new Map();
  for (const n of numeros) {
    const pagina = paginas.get(n);
    const id = String(n).padStart(casas, '0');
    const opcoes = config.paginas[n] || {};
    const slide = { n };
    if (pagina.imagem) {
      const ext = path.extname(pagina.imagem.arquivo).toLowerCase();
      fs.copyFileSync(pagina.imagem.arquivo, path.join(DIST, 'slides', id + ext));
      slide.imagem = `slides/${id}${ext}`;
      const dim = ext === '.png' ? dimensoesPng(pagina.imagem.arquivo) : null;
      if (dim) {
        Object.assign(slide, dim);
        const chave = `${dim.largura}x${dim.altura}`;
        tamanhos.set(chave, (tamanhos.get(chave) || 0) + 1);
      }
    }
    if (pagina.video) {
      const ext = path.extname(pagina.video.arquivo).toLowerCase();
      fs.copyFileSync(pagina.video.arquivo, path.join(DIST, 'slides', id + ext));
      slide.video = `slides/${id}${ext}`;
      slide.som = opcoes.som === true;
      slide.loop = opcoes.loop !== false;
    }
    slides.push(slide);
  }

  for (const chave of Object.keys(config.paginas)) {
    if (!paginas.has(parseInt(chave, 10))) {
      avisar(`player.config.json: a página ${chave} não existe em input/.`);
    }
  }
  if (tamanhos.size > 1) {
    const lista = [...tamanhos].map(([t, q]) => `${t} (${q})`).join(', ');
    avisar(`As imagens têm tamanhos diferentes: ${lista}.`);
  }
  for (let i = 1; i < numeros.length; i++) {
    if (numeros[i] !== numeros[i - 1] + 1) {
      avisar(`Numeração pula da página ${numeros[i - 1]} para a ${numeros[i]}.`);
    }
  }

  const { paginas: _fora, ...configPlayer } = config;
  const js = [
    '// Gerado por "npm run build". Não edite à mão: o próximo build sobrescreve.',
    '// Para mudar opções de forma permanente, edite player.config.json e rode o build de novo.',
    `window.PLAYER_CONFIG = ${JSON.stringify(configPlayer, null, 2)};`,
    `window.SLIDES = ${JSON.stringify(slides, null, 2)};`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(DIST, 'slides.js'), js);

  for (const arquivo of fs.readdirSync(PLAYER)) {
    fs.copyFileSync(path.join(PLAYER, arquivo), path.join(DIST, arquivo));
  }
  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

  const comVideo = slides.filter((s) => s.video).length;
  console.log(`  ${slides.length} página(s), ${comVideo} com vídeo`);
  if (tamanhos.size === 1) console.log(`  Tamanho das imagens: ${[...tamanhos.keys()][0]}`);
  avisos.forEach((a) => console.warn(`  AVISO: ${a}`));
  if (slides.length === 0) {
    console.warn('  AVISO: nenhuma página encontrada em input/. Coloque os PNGs (ou o ZIP) do Canva lá.');
  }
  console.log(`Pronto: abra ${path.relative(RAIZ, path.join(DIST, 'index.html'))}`);
}

build().catch((erro) => {
  console.error(`ERRO: ${erro.message}`);
  process.exit(1);
});
