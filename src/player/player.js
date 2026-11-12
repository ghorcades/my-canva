(function () {
  'use strict';

  var padrao = {
    titulo: 'Meu Canva',
    transicaoMs: 300,
    laser: true,
    laserOcultarMs: 2000,
    contador: false,
    loop: false
  };
  var cfg = Object.assign({}, padrao, window.PLAYER_CONFIG || {});
  var slides = Array.isArray(window.SLIDES) ? window.SLIDES : [];

  var palco = document.getElementById('palco');
  var elLaser = document.getElementById('laser');
  var elContador = document.getElementById('contador');
  var elAjuda = document.getElementById('ajuda');

  document.title = cfg.titulo || padrao.titulo;

  if (!slides.length) {
    document.getElementById('vazio').hidden = false;
    return;
  }

  var atual = -1;
  var pool = new Map();          // índice -> elemento .slide (atual e vizinhos)
  var saindo = null;             // slide que ainda está visível por baixo durante o fade
  var timerSaida = 0;
  var telaPreta = false;
  var laserLigado = cfg.laser !== false;
  var contadorLigado = cfg.contador === true;
  var digitos = '';
  var timerDigitos = 0;
  var timerParado = 0;
  var semSom = null;             // vídeo que o navegador obrigou a tocar mudo

  // ---------- Slides ----------

  function midia(el) { return el.firstChild; }

  function criar(i) {
    var s = slides[i];
    var el = document.createElement('div');
    el.className = 'slide';
    var m;
    if (s.video) {
      m = document.createElement('video');
      if (s.imagem) m.poster = s.imagem;
      m.muted = !s.som;
      m.loop = s.loop !== false;
      m.playsInline = true;
      m.preload = 'auto';
      m.disablePictureInPicture = true;
      m.src = s.video;
    } else {
      m = new Image();
      m.alt = '';
      m.draggable = false;
      m.src = s.imagem;
      if (m.decode) m.decode().catch(function () {});
    }
    el.appendChild(m);
    palco.appendChild(el);
    return el;
  }

  function descartar(el) {
    var m = midia(el);
    if (m.tagName === 'VIDEO') {
      m.pause();
      m.removeAttribute('src');
      m.load();
    }
    el.remove();
  }

  function obter(i) {
    if (!pool.has(i)) pool.set(i, criar(i));
    return pool.get(i);
  }

  function tocar(el, i) {
    var v = midia(el);
    if (v.tagName !== 'VIDEO') return;
    v.muted = !slides[i].som;
    try { v.currentTime = 0; } catch (e) {}
    var p = v.play();
    if (p && p.catch) {
      p.catch(function (erro) {
        // Sem interação prévia o Chrome só deixa tocar mudo; o som volta na próxima tecla ou clique.
        // Qualquer outra rejeição (um pause() no meio do caminho, por exemplo) não deve religar o vídeo.
        if (!erro || erro.name !== 'NotAllowedError') return;
        if (v.muted || telaPreta || pool.get(atual) !== el) return;
        v.muted = true;
        semSom = v;
        v.play().catch(function () {});
      });
    }
  }

  function pausar(el) {
    var v = midia(el);
    if (v.tagName === 'VIDEO') v.pause();
  }

  function encerrarSaida() {
    clearTimeout(timerSaida);
    if (!saindo) return;
    var el = saindo;
    saindo = null;
    el.style.transition = 'none';
    el.style.opacity = '0';
    pausar(el);
    var aindaNoPool = false;
    pool.forEach(function (v) { if (v === el) aindaNoPool = true; });
    if (!aindaNoPool) descartar(el);
  }

  function mostrar(i) {
    if (i < 0 || i >= slides.length || i === atual) return;
    encerrarSaida();

    var anterior = atual >= 0 ? pool.get(atual) : null;
    // O primeiro slide entra direto, sem fade.
    var ms = anterior ? Math.max(0, Number(cfg.transicaoMs) || 0) : 0;
    var el = obter(i);
    atual = i;

    // O novo slide aparece por cima do anterior, que só é escondido quando o fade termina.
    el.style.transition = 'none';
    el.style.opacity = '0';
    el.style.zIndex = '2';
    if (anterior) anterior.style.zIndex = '1';
    void el.offsetWidth;
    el.style.transition = ms ? 'opacity ' + ms + 'ms ease' : 'none';
    el.style.opacity = '1';
    if (!telaPreta) tocar(el, i);

    // Mantém carregados só o atual e os dois vizinhos.
    var vizinhos = [i - 1, i + 1].map(function (j) {
      return cfg.loop ? (j + slides.length) % slides.length : j;
    }).filter(function (j) { return j >= 0 && j < slides.length && j !== i; });
    vizinhos.forEach(obter);
    pool.forEach(function (v, k) {
      if (k !== i && vizinhos.indexOf(k) < 0) {
        pool.delete(k);
        if (v !== anterior) descartar(v);
      }
    });

    if (anterior) {
      saindo = anterior;
      if (ms) timerSaida = setTimeout(encerrarSaida, ms + 30);
      else encerrarSaida();
    }

    atualizarContador();
    try { history.replaceState(null, '', '#' + (i + 1)); } catch (e) {}
  }

  function proximo() {
    if (atual < slides.length - 1) mostrar(atual + 1);
    else if (cfg.loop) mostrar(0);
  }

  function anterior() {
    if (atual > 0) mostrar(atual - 1);
    else if (cfg.loop) mostrar(slides.length - 1);
  }

  // ---------- Tela preta, tela cheia, contador, ajuda ----------

  function definirTelaPreta(ligar) {
    if (telaPreta === ligar) return;
    telaPreta = ligar;
    document.body.classList.toggle('tela-preta', ligar);
    var el = pool.get(atual);
    if (!el) return;
    if (ligar) pausar(el);
    else if (midia(el).tagName === 'VIDEO') midia(el).play().catch(function () {});
  }

  function alternarTelaCheia() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(function () {});
    }
  }

  function atualizarContador() {
    if (digitos) {
      elContador.textContent = 'Ir para ' + digitos + ' ↵';
      elContador.classList.add('visivel');
    } else {
      elContador.textContent = (atual + 1) + ' / ' + slides.length;
      elContador.classList.toggle('visivel', contadorLigado);
    }
  }

  function limparDigitos() {
    clearTimeout(timerDigitos);
    digitos = '';
    atualizarContador();
  }

  // ---------- Ponteiro laser ----------

  function aplicarCursor(parado) {
    // Laser ligado: o cursor some sempre e o ponto vermelho ocupa o lugar dele.
    // Laser desligado: cursor normal, que some depois de um tempo parado.
    document.body.classList.toggle('sem-cursor', laserLigado || parado);
    if (!laserLigado || parado) elLaser.classList.remove('visivel');
  }

  function armarOcultar() {
    clearTimeout(timerParado);
    timerParado = setTimeout(function () { aplicarCursor(true); }, Math.max(200, Number(cfg.laserOcultarMs) || 2000));
  }

  function aoMoverMouse(e) {
    if (e.movementX === 0 && e.movementY === 0) return;
    if (laserLigado) {
      elLaser.style.transform = 'translate3d(' + e.clientX + 'px,' + e.clientY + 'px,0)';
      elLaser.classList.add('visivel');
    }
    aplicarCursor(false);
    armarOcultar();
  }

  // ---------- Entrada ----------

  function liberarSom() {
    if (!semSom) return;
    var v = semSom;
    semSom = null;
    var el = pool.get(atual);
    if (el && midia(el) === v && slides[atual].som) v.muted = false;
  }

  function aoTeclar(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    liberarSom();
    var k = e.key;

    if (!elAjuda.hidden) {
      elAjuda.hidden = true;
      if (k === 'Escape' || k === 'h' || k === 'H' || k === '?') { e.preventDefault(); return; }
    }

    if (k >= '0' && k <= '9' && k.length === 1) {
      e.preventDefault();
      digitos = (digitos + k).slice(0, 5);
      clearTimeout(timerDigitos);
      timerDigitos = setTimeout(limparDigitos, 4000);
      atualizarContador();
      return;
    }

    if (digitos) {
      if (k === 'Enter') {
        e.preventDefault();
        var alvo = Math.min(slides.length, Math.max(1, parseInt(digitos, 10)));
        limparDigitos();
        definirTelaPreta(false);
        mostrar(alvo - 1);
        return;
      }
      if (k === 'Backspace') {
        e.preventDefault();
        digitos = digitos.slice(0, -1);
        atualizarContador();
        return;
      }
      limparDigitos();
      if (k === 'Escape') { e.preventDefault(); return; }
    }

    var avancar = k === 'ArrowRight' || k === 'ArrowDown' || k === ' ' || k === 'Spacebar' ||
      k === 'PageDown' || k === 'Enter';
    var voltar = k === 'ArrowLeft' || k === 'ArrowUp' || k === 'PageUp' || k === 'Backspace';

    if (avancar || voltar || k === 'Home' || k === 'End') {
      e.preventDefault();
      // Como no PowerPoint: com a tela preta, a primeira tecla de navegação só traz o slide de volta.
      if (telaPreta) { definirTelaPreta(false); return; }
      if (avancar) proximo();
      else if (voltar) anterior();
      else if (k === 'Home') mostrar(0);
      else mostrar(slides.length - 1);
      return;
    }

    switch (k) {
      case 'f': case 'F':
        e.preventDefault();
        alternarTelaCheia();
        break;
      case 'b': case 'B': case '.':
        e.preventDefault();
        definirTelaPreta(!telaPreta);
        break;
      case 'Escape':
        definirTelaPreta(false);
        break;
      case 'l': case 'L':
        laserLigado = !laserLigado;
        aplicarCursor(false);
        armarOcultar();
        break;
      case 'n': case 'N':
        contadorLigado = !contadorLigado;
        atualizarContador();
        break;
      case 'h': case 'H': case '?':
        elAjuda.hidden = false;
        break;
    }
  }

  function aoClicar(e) {
    liberarSom();
    if (digitos) limparDigitos();
    if (!elAjuda.hidden) { elAjuda.hidden = true; return; }
    if (telaPreta) { definirTelaPreta(false); return; }
    if (e.button === 0) proximo();
  }

  document.addEventListener('keydown', aoTeclar);
  document.addEventListener('click', aoClicar);
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    liberarSom();
    if (digitos) limparDigitos();
    if (!elAjuda.hidden) { elAjuda.hidden = true; return; }
    if (telaPreta) { definirTelaPreta(false); return; }
    anterior();
  });
  document.addEventListener('mousemove', aoMoverMouse);
  document.addEventListener('dragstart', function (e) { e.preventDefault(); });

  // ---------- Início ----------

  var inicial = parseInt((location.hash || '').slice(1), 10);
  if (!(inicial >= 1 && inicial <= slides.length)) inicial = 1;
  aplicarCursor(true);
  mostrar(inicial - 1);

  window.addEventListener('hashchange', function () {
    var n = parseInt((location.hash || '').slice(1), 10);
    if (n >= 1 && n <= slides.length) mostrar(n - 1);
  });
})();
