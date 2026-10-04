/* =====================================================================
   VERTAG CRM · web
   Login, pipeline (kanban), ficha del lead y seguimientos.
   Sin dependencias salvo supabase-js (se carga en index.html).
   ===================================================================== */
(function () {
  'use strict';

  var CFG = window.VERTAG_CONFIG || {};
  var appEl = document.getElementById('app');

  if (!window.supabase || !CFG.SUPABASE_URL || !CFG.SUPABASE_KEY) {
    appEl.innerHTML = '<div class="center-msg"><h1>No se pudo iniciar</h1><p>Revisá config.js y la conexión a internet.</p></div>';
    return;
  }

  var sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
  var TZ = 'America/Argentina/Buenos_Aires';
  var MS_DIA = 86400000;
  var DIAS_CERRADOS = 30; // en el tablero, ganados/perdidos de los últimos 30 días

  var S = {
    user: null, perfil: null, cliente: null,
    etapas: [], equipo: [], campanas: [], leads: [],
    filtro: { q: '', resp: '', origen: '', perdidos: false },
    vista: 'pipeline', leadId: null, canal: null, dragId: null, timer: null
  };

  /* ------------------------------------------------------------------
     Utilidades
     ------------------------------------------------------------------ */
  function $(sel, root) { return (root || document).querySelector(sel); }

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) {
    return '$ ' + Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 0 });
  }

  function fmtFecha(iso) {
    if (!iso) return '';
    return new Date(iso).toLocaleString('es-AR', { timeZone: TZ, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  function fmtHora(iso) {
    return new Date(iso).toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
  }

  function dayKey(d) {
    return new Date(d).toLocaleDateString('en-CA', { timeZone: TZ });
  }

  function hace(iso) {
    var s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'recién';
    var m = Math.floor(s / 60);
    if (m < 60) return 'hace ' + m + ' min';
    var h = Math.floor(m / 60);
    if (h < 24) return 'hace ' + h + ' h';
    return 'hace ' + Math.floor(h / 24) + ' d';
  }

  function inicioSemana() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }

  function iniciales(nombre) {
    var p = String(nombre || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  }

  function vacioANull(v) {
    v = (v == null ? '' : String(v)).trim();
    return v === '' ? null : v;
  }

  var ICON = {
    search: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4-4"/></svg>',
    clock: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    plus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    back: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
    pipe: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="3" width="5" height="12" rx="1"/><rect x="17" y="3" width="4" height="8" rx="1"/></svg>',
    task: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/></svg>',
    mark: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FFFFFF" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6l7 13 7-13"/></svg>'
  };

  var COLORES_AVATAR = [
    ['#E6E1F5', '#3F2E7A'], ['#DCE7F5', '#1B3A66'], ['#E3F4EE', '#08795A'],
    ['#FFF1CC', '#7A5200'], ['#FDECEA', '#B42318'], ['#EEF1F5', '#34475F']
  ];

  function toast(msg, esError) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'show' + (esError ? ' err' : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.className = ''; }, 3800);
  }

  function msgError(err) {
    var m = (err && err.message) || String(err);
    if (err && err.code === '23505') return 'Ya existe un lead con ese teléfono.';
    if (/row-level security|permission denied/i.test(m)) return 'No tenés permiso para hacer eso.';
    return 'No se pudo guardar: ' + m;
  }

  /* ------------------------------------------------------------------
     Datos
     ------------------------------------------------------------------ */
  function datos(q) {
    return q.then(function (r) {
      if (r.error) throw r.error;
      return r.data;
    });
  }

  function cargarTodo() {
    return datos(sb.from('perfiles').select('*').eq('id', S.user.id).maybeSingle()).then(function (perfil) {
      S.perfil = perfil;
      if (!perfil) return false;
      return Promise.all([
        datos(sb.from('clientes').select('*').eq('id', perfil.cliente_id).maybeSingle()),
        datos(sb.from('etapas').select('*').order('orden', { ascending: true })),
        datos(sb.from('perfiles').select('id,nombre,rol').eq('activo', true).order('nombre', { ascending: true })),
        datos(sb.from('campanas').select('id,nombre').eq('activa', true).order('nombre', { ascending: true })),
        datos(sb.from('leads').select('*').order('creado_en', { ascending: false }).limit(1000))
      ]).then(function (r) {
        S.cliente = r[0];
        S.etapas = r[1] || [];
        S.equipo = r[2] || [];
        S.campanas = r[3] || [];
        S.leads = r[4] || [];
        return true;
      });
    });
  }

  function recargarLeads() {
    return datos(sb.from('leads').select('*').order('creado_en', { ascending: false }).limit(1000)).then(function (rows) {
      S.leads = rows || [];
    });
  }

  function leadPorId(id) {
    for (var i = 0; i < S.leads.length; i++) if (S.leads[i].id === id) return S.leads[i];
    return null;
  }

  function reemplazarLead(row) {
    for (var i = 0; i < S.leads.length; i++) {
      if (S.leads[i].id === row.id) { S.leads[i] = row; return; }
    }
    S.leads.unshift(row);
  }

  function etapaPorId(id) {
    for (var i = 0; i < S.etapas.length; i++) if (S.etapas[i].id === id) return S.etapas[i];
    return null;
  }

  function primeraEtapa() {
    for (var i = 0; i < S.etapas.length; i++) if (S.etapas[i].tipo === 'abierta') return S.etapas[i];
    return null;
  }

  function etapaDeTipo(tipo) {
    for (var i = 0; i < S.etapas.length; i++) if (S.etapas[i].tipo === tipo) return S.etapas[i];
    return null;
  }

  function nombreDe(id) {
    for (var i = 0; i < S.equipo.length; i++) if (S.equipo[i].id === id) return S.equipo[i].nombre;
    return null;
  }

  function nombreCampana(id) {
    for (var i = 0; i < S.campanas.length; i++) if (S.campanas[i].id === id) return S.campanas[i].nombre;
    return null;
  }

  function avatarDe(id) {
    var idx = -1, i;
    for (i = 0; i < S.equipo.length; i++) if (S.equipo[i].id === id) idx = i;
    if (idx < 0) return { ini: '?', bg: '#EEF1F5', fg: '#34475F', nombre: 'Sin asignar' };
    var c = COLORES_AVATAR[idx % COLORES_AVATAR.length];
    return { ini: iniciales(S.equipo[idx].nombre), bg: c[0], fg: c[1], nombre: S.equipo[idx].nombre };
  }

  // Cambia un lead con actualización inmediata en pantalla y la deshace si falla
  function actualizarLead(id, patch, okMsg) {
    var l = leadPorId(id);
    if (!l) return Promise.resolve(null);
    var previo = Object.assign({}, l);
    Object.assign(l, patch);
    refrescarVista();
    return sb.from('leads').update(patch).eq('id', id).select().single().then(function (r) {
      if (r.error) throw r.error;
      reemplazarLead(r.data);
      if (okMsg) toast(okMsg);
      refrescarVista();
      return r.data;
    }).catch(function (err) {
      reemplazarLead(previo);
      refrescarVista();
      toast(msgError(err), true);
      return null;
    });
  }

  function registrarEvento(leadId, tipo, titulo, detalle) {
    return sb.from('eventos').insert({
      cliente_id: S.perfil.cliente_id, lead_id: leadId, tipo: tipo,
      titulo: titulo, detalle: detalle || null, fuente: 'CRM'
    }).then(function (r) {
      if (r.error) throw r.error;
    });
  }

  /* ------------------------------------------------------------------
     Arranque y sesión
     ------------------------------------------------------------------ */
  function iniciar() {
    sb.auth.onAuthStateChange(function (evento) {
      if (evento === 'SIGNED_OUT') { desmontar(); renderLogin(); }
    });
    sb.auth.getSession().then(function (r) {
      var sesion = r.data && r.data.session;
      if (!sesion) return renderLogin();
      S.user = sesion.user;
      arrancar();
    });
  }

  function arrancar() {
    appEl.innerHTML = '<div class="loading">Cargando…</div>';
    cargarTodo().then(function (ok) {
      if (!ok) return renderSinAcceso();
      renderShell();
      ruta();
      suscribir();
    }).catch(function (err) {
      renderErrorCarga(err);
    });
  }

  function desmontar() {
    if (S.canal) { try { sb.removeChannel(S.canal); } catch (e) { /* nada */ } S.canal = null; }
    S.user = null; S.perfil = null; S.leads = [];
  }

  function cerrarSesion() {
    sb.auth.signOut().then(function () { desmontar(); renderLogin(); });
  }

  function renderLogin(msg) {
    appEl.innerHTML =
      '<div class="login-wrap"><form class="login" id="login-form">' +
        '<div class="brand"><div class="brand-mark">' + ICON.mark + '</div>' +
        '<div class="brand-text"><b>VERTAG</b><span>CRM</span></div></div>' +
        '<label class="field">Email<input type="email" name="email" autocomplete="username" required></label>' +
        '<label class="field">Contraseña<input type="password" name="password" autocomplete="current-password" required></label>' +
        '<p class="form-error" id="login-err" role="alert">' + esc(msg || '') + '</p>' +
        '<button class="btn btn-primary" type="submit">Ingresar</button>' +
      '</form></div>';
    var f = $('#login-form');
    f.querySelector('input').focus();
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = f.querySelector('button');
      btn.disabled = true;
      sb.auth.signInWithPassword({ email: f.email.value.trim(), password: f.password.value }).then(function (r) {
        if (r.error) {
          btn.disabled = false;
          $('#login-err').textContent = /invalid login/i.test(r.error.message) ? 'Email o contraseña incorrectos.' : r.error.message;
          return;
        }
        S.user = r.data.user;
        arrancar();
      });
    });
  }

  function renderSinAcceso() {
    appEl.innerHTML =
      '<div class="center-msg"><h1>Todavía no tenés acceso</h1>' +
      '<p>Tu usuario existe, pero no está vinculado a ninguna empresa en el CRM. Pedile a Vertag que te dé acceso.</p>' +
      '<button class="btn" data-action="logout">Salir</button></div>';
  }

  function renderErrorCarga(err) {
    appEl.innerHTML =
      '<div class="center-msg"><h1>No se pudieron cargar los datos</h1><p>' + esc((err && err.message) || err) + '</p>' +
      '<div class="row"><button class="btn btn-primary" data-action="reintentar">Reintentar</button>' +
      '<button class="btn" data-action="logout">Salir</button></div></div>';
  }

  /* ------------------------------------------------------------------
     Estructura y rutas
     ------------------------------------------------------------------ */
  function renderShell() {
    appEl.innerHTML =
      '<div class="shell">' +
        '<aside class="side">' +
          '<div class="brand"><div class="brand-mark">' + ICON.mark + '</div>' +
          '<div class="brand-text"><b>VERTAG</b><span>CRM</span></div></div>' +
          '<nav aria-label="Principal">' +
            '<a class="nav-link" id="nav-pipeline" href="#/">' + ICON.pipe + 'Pipeline</a>' +
            '<a class="nav-link" id="nav-seguimientos" href="#/seguimientos">' + ICON.task + 'Seguimientos<span class="badge" id="badge-seg" hidden></span></a>' +
          '</nav>' +
          '<div class="side-foot"><small>Cliente</small><b>' + esc(S.cliente ? S.cliente.nombre : '') + '</b>' +
          '<span>' + esc(S.perfil.nombre) + ' · ' + esc(S.perfil.rol) + '</span>' +
          '<button class="link-btn" data-action="logout">Cerrar sesión</button></div>' +
        '</aside>' +
        '<main class="main" id="main"></main>' +
      '</div>';
  }

  function ruta() {
    if (!S.perfil) return;
    var h = location.hash || '#/';
    var m = h.match(/^#\/lead\/([0-9a-fA-F-]{36})$/);
    if (m) { S.vista = 'ficha'; S.leadId = m[1]; }
    else if (h === '#/seguimientos') { S.vista = 'seguimientos'; S.leadId = null; }
    else { S.vista = 'pipeline'; S.leadId = null; }

    var np = $('#nav-pipeline'), ns = $('#nav-seguimientos');
    if (np) np.className = 'nav-link' + (S.vista !== 'seguimientos' ? ' active' : '');
    if (ns) ns.className = 'nav-link' + (S.vista === 'seguimientos' ? ' active' : '');

    if (S.vista === 'ficha') renderFicha();
    else if (S.vista === 'seguimientos') renderSeguimientos();
    else renderPipeline();
    actualizarBadge();
    window.scrollTo(0, 0);
  }

  function refrescarVista() {
    if (S.vista === 'pipeline') { renderKpis(); renderBoard(); }
    else if (S.vista === 'ficha') { renderFichaHead(); }
    else if (S.vista === 'seguimientos') { renderSeguimientos(); }
    actualizarBadge();
  }

  function actualizarBadge() {
    var b = $('#badge-seg');
    if (!b) return;
    var n = vencidos().length;
    b.textContent = n;
    b.hidden = n === 0;
  }

  /* ------------------------------------------------------------------
     Pipeline
     ------------------------------------------------------------------ */
  function abiertos() {
    return S.leads.filter(function (l) { var e = etapaPorId(l.etapa_id); return e && e.tipo === 'abierta'; });
  }

  function vencidos() {
    var ahora = Date.now();
    return abiertos().filter(function (l) { return l.proxima_accion_vence && new Date(l.proxima_accion_vence).getTime() < ahora; });
  }

  function sinContactar() {
    var p = primeraEtapa();
    return abiertos().filter(function (l) { return p && l.etapa_id === p.id && !l.ultimo_contacto; });
  }

  function leadsVisibles() {
    var q = S.filtro.q.trim().toLowerCase();
    return S.leads.filter(function (l) {
      if (S.filtro.resp === 'none' && l.responsable_id) return false;
      if (S.filtro.resp && S.filtro.resp !== 'none' && l.responsable_id !== S.filtro.resp) return false;
      if (S.filtro.origen && l.origen !== S.filtro.origen) return false;
      if (q) {
        var txt = [l.nombre, l.telefono, l.interes, l.origen].join(' ').toLowerCase();
        if (txt.indexOf(q) < 0) return false;
      }
      return true;
    });
  }

  function renderPipeline() {
    var origenes = [];
    S.leads.forEach(function (l) { if (l.origen && origenes.indexOf(l.origen) < 0) origenes.push(l.origen); });
    origenes.sort();

    var optsOrigen = '<option value="">Origen: todos</option>' + origenes.map(function (o) {
      return '<option value="' + esc(o) + '"' + (S.filtro.origen === o ? ' selected' : '') + '>' + esc(o) + '</option>';
    }).join('');
    var optsResp = '<option value="">Responsable: todos</option><option value="none"' + (S.filtro.resp === 'none' ? ' selected' : '') + '>Sin asignar</option>' +
      S.equipo.map(function (p) {
        return '<option value="' + esc(p.id) + '"' + (S.filtro.resp === p.id ? ' selected' : '') + '>' + esc(p.nombre) + '</option>';
      }).join('');

    $('#main').innerHTML =
      '<header class="top"><div><h1>Pipeline</h1><p class="sub">Arrastrá cada lead a la etapa que le corresponde.</p></div>' +
      '<div class="tools">' +
        '<label class="search">' + ICON.search + '<input id="f-q" type="search" aria-label="Buscar lead" placeholder="Buscar por nombre o teléfono" value="' + esc(S.filtro.q) + '"></label>' +
        '<select id="f-origen" aria-label="Filtrar por origen">' + optsOrigen + '</select>' +
        '<select id="f-resp" aria-label="Filtrar por responsable">' + optsResp + '</select>' +
        '<button class="btn" data-action="toggle-perdidos" aria-pressed="' + S.filtro.perdidos + '">Ver perdidos</button>' +
        '<button class="btn btn-primary" data-action="nuevo-lead">' + ICON.plus + 'Nuevo lead</button>' +
      '</div></header>' +
      '<div class="kpis" id="kpis"></div>' +
      '<div class="board" id="board"></div>';
    renderKpis();
    renderBoard();
  }

  function renderKpis() {
    var el = $('#kpis');
    if (!el) return;
    var ab = abiertos();
    var total = ab.reduce(function (a, l) { return a + Number(l.valor_estimado || 0); }, 0);
    var desde = inicioSemana().getTime();
    var ganSemana = S.leads.filter(function (l) { return l.ganado_en && new Date(l.ganado_en).getTime() >= desde; });
    var montoGan = ganSemana.reduce(function (a, l) { return a + Number(l.valor_final != null ? l.valor_final : l.valor_estimado || 0); }, 0);
    var sc = sinContactar().length, ve = vencidos().length;

    function kpi(label, valor, nota, cls) {
      return '<div class="kpi ' + (cls || '') + '"><small>' + label + '</small><b>' + valor + '</b><span>' + nota + '</span></div>';
    }
    el.innerHTML =
      kpi('Pipeline abierto', money(total), ab.length + ' leads en curso', '') +
      kpi('Ganado esta semana', money(montoGan), ganSemana.length + (ganSemana.length === 1 ? ' venta cerrada' : ' ventas cerradas'), ganSemana.length ? 'good' : '') +
      kpi('Sin contactar', sc, 'Primer contacto pendiente', sc ? 'bad' : '') +
      kpi('Seguimientos vencidos', ve, 'Pasó la fecha acordada', ve ? 'bad' : '');
  }

  function tagsDe(l, primeraId) {
    var t = [];
    var e = etapaPorId(l.etapa_id);
    if (!e || e.tipo !== 'abierta') return t;
    if (l.etapa_id === primeraId && !l.ultimo_contacto) t.push(['red', 'Sin contactar']);
    if (l.caliente) t.push(['amber', 'Caliente']);
    if (l.proxima_accion_vence) {
      var v = new Date(l.proxima_accion_vence), ahora = new Date();
      if (v < ahora) t.push(['red', 'Seguimiento vencido']);
      else if (dayKey(v) === dayKey(ahora)) t.push(['green', 'Seguimiento hoy ' + fmtHora(l.proxima_accion_vence)]);
      else if (dayKey(v) === dayKey(ahora.getTime() + MS_DIA)) t.push(['green', 'Seguimiento mañana']);
    }
    return t;
  }

  function cardHtml(l, primeraId) {
    var av = avatarDe(l.responsable_id);
    var tags = tagsDe(l, primeraId).map(function (t) {
      return '<span class="tag ' + t[0] + '">' + esc(t[1]) + '</span>';
    }).join('');
    var e = etapaPorId(l.etapa_id);
    var monto = e && e.tipo === 'ganada' && l.valor_final != null ? l.valor_final : l.valor_estimado;
    return '<div class="card" draggable="true" data-lead="' + esc(l.id) + '">' +
      '<div class="card-top"><a class="card-name" href="#/lead/' + esc(l.id) + '">' + esc(l.nombre) + '</a>' +
      '<span class="avatar" style="background:' + av.bg + ';color:' + av.fg + '" title="' + esc(av.nombre) + '" aria-label="Responsable: ' + esc(av.nombre) + '">' + esc(av.ini) + '</span></div>' +
      (l.interes ? '<span class="card-int">' + esc(l.interes) + '</span>' : '') +
      (l.origen ? '<span class="chip">' + esc(l.origen) + '</span>' : '') +
      '<div class="card-bottom"><b>' + money(monto) + '</b><span>' + ICON.clock + esc(hace(l.creado_en)) + '</span></div>' +
      (tags ? '<div class="tags">' + tags + '</div>' : '') +
    '</div>';
  }

  function renderBoard() {
    var el = $('#board');
    if (!el) return;
    var visibles = leadsVisibles();
    var primera = primeraEtapa();
    var primeraId = primera ? primera.id : null;
    var corte = Date.now() - DIAS_CERRADOS * MS_DIA;

    el.innerHTML = S.etapas.filter(function (e) {
      return e.tipo !== 'perdida' || S.filtro.perdidos;
    }).map(function (e) {
      var ls = visibles.filter(function (l) {
        if (l.etapa_id !== e.id) return false;
        if (e.tipo === 'ganada') return l.ganado_en && new Date(l.ganado_en).getTime() >= corte;
        if (e.tipo === 'perdida') return l.perdido_en && new Date(l.perdido_en).getTime() >= corte;
        return true;
      });
      if (e.tipo === 'ganada') ls.sort(function (a, b) { return new Date(b.ganado_en) - new Date(a.ganado_en); });
      if (e.tipo === 'perdida') ls.sort(function (a, b) { return new Date(b.perdido_en) - new Date(a.perdido_en); });
      var total = ls.reduce(function (a, l) {
        return a + Number(e.tipo === 'ganada' && l.valor_final != null ? l.valor_final : l.valor_estimado || 0);
      }, 0);
      var nota = e.tipo === 'abierta' ? '' : ' · últimos ' + DIAS_CERRADOS + ' días';
      return '<section class="col" data-etapa="' + esc(e.id) + '" aria-label="Etapa ' + esc(e.nombre) + '">' +
        '<div class="col-head"><div class="col-title"><span class="dot" style="background:' + esc(e.color) + '"></span>' + esc(e.nombre) +
        '<span class="count">' + ls.length + '</span></div>' +
        '<span class="col-total">' + money(total) + nota + '</span></div>' +
        (ls.length ? ls.map(function (l) { return cardHtml(l, primeraId); }).join('') : '<div class="col-empty">Sin leads</div>') +
      '</section>';
    }).join('');
  }

  function moverLead(id, etapaId) {
    var l = leadPorId(id), destino = etapaPorId(etapaId);
    if (!l || !destino || l.etapa_id === etapaId) return;
    if (destino.tipo === 'perdida') return modalPerdido(l, destino);
    actualizarLead(id, { etapa_id: etapaId });
  }

  /* ------------------------------------------------------------------
     Modales
     ------------------------------------------------------------------ */
  function abrirModal(html, alEnviar) {
    var dlg = $('#modal');
    dlg.innerHTML = '<form id="mform">' + html + '<p class="form-error" id="merr" role="alert"></p></form>';
    var f = $('#mform');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var btn = f.querySelector('button[type=submit]');
      btn.disabled = true;
      Promise.resolve(alEnviar(new FormData(f))).then(function (res) {
        if (res === false) btn.disabled = false;
        else dlg.close();
      }).catch(function (err) {
        btn.disabled = false;
        $('#merr').textContent = msgError(err);
      });
    });
    if (!dlg.open) dlg.showModal();
    var primero = f.querySelector('input,select,textarea');
    if (primero) primero.focus();
  }

  function selectHtml(name, label, opciones, valor, vacio) {
    return '<label class="field">' + label + '<select name="' + name + '">' +
      (vacio ? '<option value="">' + vacio + '</option>' : '') +
      opciones.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === valor ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select></label>';
  }

  function modalNuevoLead() {
    abrirModal(
      '<h2>Nuevo lead</h2>' +
      '<label class="field">Nombre<input name="nombre" required maxlength="120"></label>' +
      '<label class="field">Teléfono<input name="telefono" type="tel" placeholder="+54 9 376 …" maxlength="40"></label>' +
      '<label class="field">Interés<input name="interes" placeholder="Ej: pedido para evento" maxlength="160"></label>' +
      '<div class="row"><label class="field">Valor estimado ($)<input name="valor" type="number" min="0" step="1" value="0"></label>' +
      selectHtml('campana', 'Campaña', S.campanas.map(function (c) { return [c.id, c.nombre]; }), '', 'Sin campaña') + '</div>' +
      '<div class="row"><label class="field">Origen<input name="origen" value="Manual" maxlength="80"></label>' +
      selectHtml('responsable', 'Responsable', S.equipo.map(function (p) { return [p.id, p.nombre]; }), S.perfil.id, 'Sin asignar') + '</div>' +
      '<div class="modal-actions"><button class="btn" type="button" data-action="cerrar-modal">Cancelar</button>' +
      '<button class="btn btn-primary" type="submit">Crear lead</button></div>',
      function (fd) {
        var nombre = String(fd.get('nombre') || '').trim();
        if (!nombre) { $('#merr').textContent = 'Poné un nombre.'; return false; }
        return sb.from('leads').insert({
          cliente_id: S.perfil.cliente_id,
          nombre: nombre,
          telefono: vacioANull(fd.get('telefono')),
          interes: vacioANull(fd.get('interes')),
          valor_estimado: Number(fd.get('valor') || 0),
          campana_id: vacioANull(fd.get('campana')),
          origen: vacioANull(fd.get('origen')),
          responsable_id: vacioANull(fd.get('responsable'))
        }).select().single().then(function (r) {
          if (r.error) throw r.error;
          reemplazarLead(r.data);
          toast('Lead creado');
          refrescarVista();
        });
      }
    );
  }

  function modalGanado(l) {
    var destino = etapaDeTipo('ganada');
    if (!destino) return toast('No hay una etapa de tipo Ganado.', true);
    abrirModal(
      '<h2>Marcar como ganado</h2><p class="sub">¿Cuánto se vendió finalmente a ' + esc(l.nombre) + '?</p>' +
      '<label class="field">Valor final ($)<input name="valor" type="number" min="0" step="1" value="' + esc(l.valor_final != null ? l.valor_final : l.valor_estimado) + '" required></label>' +
      '<div class="modal-actions"><button class="btn" type="button" data-action="cerrar-modal">Cancelar</button>' +
      '<button class="btn btn-primary" type="submit">Confirmar venta</button></div>',
      function (fd) {
        return actualizarLead(l.id, { etapa_id: destino.id, valor_final: Number(fd.get('valor') || 0) }, 'Venta registrada').then(function (r) {
          if (!r) return false;
        });
      }
    );
  }

  var MOTIVOS = ['Precio', 'No respondió', 'Compró en otro lado', 'Fuera de zona', 'Ya no lo necesita', 'Otro'];

  function modalPerdido(l, destino) {
    destino = destino || etapaDeTipo('perdida');
    if (!destino) return toast('No hay una etapa de tipo Perdido.', true);
    abrirModal(
      '<h2>Marcar como perdido</h2><p class="sub">Anotar el motivo ayuda a mejorar la publicidad y la venta.</p>' +
      selectHtml('motivo', 'Motivo', MOTIVOS.map(function (m) { return [m, m]; }), 'Precio') +
      '<label class="field">Detalle (opcional)<input name="detalle" maxlength="200"></label>' +
      '<div class="modal-actions"><button class="btn" type="button" data-action="cerrar-modal">Cancelar</button>' +
      '<button class="btn btn-dark" type="submit">Marcar perdido</button></div>',
      function (fd) {
        var motivo = fd.get('motivo') + (vacioANull(fd.get('detalle')) ? ' · ' + String(fd.get('detalle')).trim() : '');
        return actualizarLead(l.id, { etapa_id: destino.id, motivo_perdida: motivo }, 'Lead marcado como perdido').then(function (r) {
          if (!r) return false;
        });
      }
    );
  }

  /* ------------------------------------------------------------------
     Ficha del lead
     ------------------------------------------------------------------ */
  function renderFicha() {
    var l = leadPorId(S.leadId);
    var main = $('#main');
    if (!l) {
      main.innerHTML = '<a class="back" href="#/">' + ICON.back + 'Volver al pipeline</a><div class="panel"><h2>Lead no encontrado</h2><p class="empty">Puede que haya sido eliminado o que no tengas acceso.</p></div>';
      return;
    }
    var vendedores = S.equipo.map(function (p) { return [p.id, p.nombre]; });
    var campanas = S.campanas.map(function (c) { return [c.id, c.nombre]; });

    main.innerHTML =
      '<a class="back" href="#/">' + ICON.back + 'Volver al pipeline</a>' +
      '<section class="panel" id="f-head"></section>' +
      '<div class="grid">' +
        '<div class="grid-main">' +
          '<section class="next" id="f-next"></section>' +
          '<section class="panel"><h2>Actividad</h2>' +
            '<form id="f-nota-form" class="field">' +
              '<label class="field">Agregar nota<textarea name="nota" rows="2" placeholder="Escribí algo que el equipo tenga que saber" maxlength="2000"></textarea></label>' +
              '<div class="modal-actions"><button class="btn btn-primary" type="submit">Guardar nota</button></div>' +
            '</form>' +
            '<ul class="timeline" id="f-timeline"><li class="empty">Cargando…</li></ul>' +
          '</section>' +
        '</div>' +
        '<div class="grid-side">' +
          '<section class="panel"><h2>Datos del lead</h2>' +
            '<form id="f-data-form" style="display:flex;flex-direction:column;gap:12px">' +
              '<label class="field">Nombre<input name="nombre" required maxlength="120" value="' + esc(l.nombre) + '"></label>' +
              '<label class="field">Teléfono<input name="telefono" type="tel" maxlength="40" value="' + esc(l.telefono || '') + '"></label>' +
              '<label class="field">Interés<input name="interes" maxlength="160" value="' + esc(l.interes || '') + '"></label>' +
              '<div class="row"><label class="field">Valor estimado ($)<input name="valor" type="number" min="0" step="1" value="' + esc(l.valor_estimado) + '"></label>' +
              '<label class="field">Valor final ($)<input name="valor_final" type="number" min="0" step="1" value="' + esc(l.valor_final != null ? l.valor_final : '') + '"></label></div>' +
              selectHtml('responsable', 'Responsable', vendedores, l.responsable_id || '', 'Sin asignar') +
              selectHtml('campana', 'Campaña', campanas, l.campana_id || '', 'Sin campaña') +
              '<label class="field">Etiquetas (separadas por coma)<input name="etiquetas" maxlength="200" value="' + esc((l.etiquetas || []).join(', ')) + '"></label>' +
              '<button class="btn btn-primary" type="submit">Guardar cambios</button>' +
            '</form>' +
          '</section>' +
          '<section class="panel"><h2>Origen y atribución</h2><div class="kv">' +
            '<div><span>Origen</span><b>' + esc(l.origen || '—') + '</b></div>' +
            '<div><span>Plataforma</span><b>' + esc(l.plataforma || '—') + '</b></div>' +
            '<div><span>Campaña</span><b>' + esc(nombreCampana(l.campana_id) || '—') + '</b></div>' +
            '<div><span>Anuncio</span><b>' + esc(l.anuncio || '—') + '</b></div>' +
          '</div></section>' +
        '</div>' +
      '</div>';
    renderFichaHead();
    cargarTimeline();
  }

  function renderFichaHead() {
    var l = leadPorId(S.leadId);
    var head = $('#f-head');
    if (!l || !head) return;
    var e = etapaPorId(l.etapa_id) || { nombre: '—', tipo: 'abierta', color: '#7B8AA0', orden: 0 };
    var wa = l.telefono ? String(l.telefono_norm || l.telefono).replace(/\D/g, '') : '';

    var pasos = S.etapas.filter(function (x) { return x.tipo !== 'perdida'; });
    var idxAct = -1;
    pasos.forEach(function (x, i) { if (x.id === l.etapa_id) idxAct = i; });
    var stepper = pasos.map(function (x, i) {
      var cls = 'step' + (i <= idxAct ? ' done' : '') + (i === idxAct ? ' now' : '');
      return '<div class="' + cls + '"><i></i><span>' + esc(x.nombre) + (i === idxAct ? ' · actual' : '') + '</span></div>';
    }).join('');

    var acciones = '';
    if (wa) acciones += '<a class="btn" target="_blank" rel="noopener" href="https://wa.me/' + esc(wa) + '">Abrir en WhatsApp</a>';
    if (e.tipo === 'abierta' && !l.ultimo_contacto) acciones += '<button class="btn" data-action="marcar-contactado">Marcar contactado</button>';
    if (e.tipo === 'abierta') {
      acciones += '<button class="btn btn-danger" data-action="marcar-perdido">Marcar perdido</button>' +
                  '<button class="btn btn-primary" data-action="marcar-ganado">Marcar ganado</button>';
    } else {
      acciones += '<button class="btn" data-action="reabrir">Reabrir lead</button>';
    }

    var etapaSel = '<label class="field" style="flex-direction:row;align-items:center;gap:8px">Etapa' +
      '<select id="f-etapa" aria-label="Cambiar etapa" style="min-height:44px;padding:0 10px;border-radius:10px;border:1px solid #D2D9E4;background:#fff;font-weight:600">' +
      S.etapas.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === l.etapa_id ? ' selected' : '') + '>' + esc(x.nombre) + '</option>'; }).join('') +
      '</select></label>';

    head.innerHTML =
      '<div class="head"><div class="head-id"><span class="avatar-lg">' + esc(iniciales(l.nombre)) + '</span><div>' +
        '<h1>' + esc(l.nombre) + '</h1>' +
        '<div class="head-meta">' +
          '<span class="chip-etapa" style="background:' + esc(e.color) + '22;color:' + esc(e.color) + '">' + esc(e.nombre) + '</span>' +
          '<button class="btn" style="min-height:30px;padding:0 10px;font-size:12px" data-action="toggle-caliente" aria-pressed="' + !!l.caliente + '">' + (l.caliente ? 'Caliente ✓' : 'Marcar caliente') + '</button>' +
          (l.telefono ? '<span class="soft">' + esc(l.telefono) + '</span>' : '') +
          '<span class="soft">· Ingresó ' + esc(fmtFecha(l.creado_en)) + '</span>' +
        '</div>' +
        (e.tipo === 'perdida' && l.motivo_perdida ? '<p class="sub">Motivo: ' + esc(l.motivo_perdida) + '</p>' : '') +
      '</div></div><div class="head-actions">' + etapaSel + acciones + '</div></div>' +
      '<div class="stepper">' + stepper + '</div>';

    renderProximaAccion(l);
  }

  function aLocalInput(iso) {
    if (!iso) return '';
    var d = new Date(iso), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  function renderProximaAccion(l) {
    var box = $('#f-next');
    if (!box) return;
    // Si la persona está escribiendo en el formulario, no se lo pisamos
    if (box.contains(document.activeElement) && document.activeElement.tagName !== 'BODY' && box.dataset.lead === l.id) return;
    box.dataset.lead = l.id;
    var tiene = !!(l.proxima_accion || l.proxima_accion_vence);
    var tarde = l.proxima_accion_vence && new Date(l.proxima_accion_vence) < new Date();
    box.innerHTML =
      '<small>Próxima acción</small>' +
      (tiene
        ? '<div><div class="now-text">' + esc(l.proxima_accion || 'Seguimiento') + '</div>' +
          '<div class="now-when' + (tarde ? ' late' : '') + '">' +
            (l.proxima_accion_vence ? (tarde ? 'Venció ' : 'Vence ') + esc(fmtFecha(l.proxima_accion_vence)) : 'Sin fecha') +
            ' · Responsable: ' + esc(avatarDe(l.responsable_id).nombre) + '</div></div>'
        : '<div class="now-text">No hay una próxima acción programada</div>') +
      '<form id="f-next-form" style="display:flex;flex-direction:column;gap:12px">' +
        '<div class="row"><label class="field">Qué hay que hacer<input name="accion" maxlength="200" value="' + esc(l.proxima_accion || '') + '" placeholder="Ej: enviar cotización"></label>' +
        '<label class="field">Cuándo<input name="vence" type="datetime-local" value="' + esc(aLocalInput(l.proxima_accion_vence)) + '"></label></div>' +
        '<div class="next-actions"><button class="btn btn-dark" type="submit">' + (tiene ? 'Reprogramar' : 'Programar') + '</button>' +
        (tiene ? '<button class="btn" type="button" data-action="completar-accion">Completar</button>' : '') + '</div>' +
      '</form>';
  }

  var COLOR_EVENTO = {
    lead_creado: '#2F6FDE', cambio_etapa: '#08795A', nota: '#0E1A2B',
    seguimiento: '#D98A00', asignacion: '#7B8AA0', mensaje: '#7B8AA0'
  };

  function cargarTimeline() {
    var id = S.leadId;
    datos(sb.from('eventos').select('*').eq('lead_id', id).order('creado_en', { ascending: false })).then(function (rows) {
      var ul = $('#f-timeline');
      if (!ul || S.leadId !== id) return;
      if (!rows || !rows.length) { ul.innerHTML = '<li class="empty">Todavía no hay actividad.</li>'; return; }
      ul.innerHTML = rows.map(function (ev) {
        var autor = ev.creado_por ? nombreDe(ev.creado_por) : null;
        return '<li style="--dot:' + (COLOR_EVENTO[ev.tipo] || '#7B8AA0') + '">' +
          '<div class="ev-title">' + esc(ev.titulo) + '<span class="chip">' + esc(ev.fuente) + (autor ? ' · ' + esc(autor) : '') + '</span></div>' +
          (ev.detalle ? '<div class="ev-detail">' + esc(ev.detalle) + '</div>' : '') +
          '<div class="ev-time">' + esc(fmtFecha(ev.creado_en)) + '</div></li>';
      }).join('');
    }).catch(function (err) {
      var ul = $('#f-timeline');
      if (ul) ul.innerHTML = '<li class="empty">No se pudo cargar la actividad: ' + esc(err.message) + '</li>';
    });
  }

  /* ------------------------------------------------------------------
     Seguimientos
     ------------------------------------------------------------------ */
  function renderSeguimientos() {
    var main = $('#main');
    if (!main) return;
    var ls = abiertos().filter(function (l) { return l.proxima_accion_vence; });
    ls.sort(function (a, b) { return new Date(a.proxima_accion_vence) - new Date(b.proxima_accion_vence); });
    var ahora = Date.now();
    var sin = abiertos().filter(function (l) { return !l.proxima_accion_vence; }).length;

    main.innerHTML =
      '<header class="top"><div><h1>Seguimientos</h1><p class="sub">Lo que hay que hacer, ordenado por fecha. Abrí un lead para programar o completar su próxima acción.</p></div></header>' +
      '<section class="panel">' +
        (ls.length
          ? '<div class="table-wrap"><table><thead><tr><th>Lead</th><th>Acción</th><th>Vence</th><th>Responsable</th><th>Etapa</th></tr></thead><tbody>' +
            ls.map(function (l) {
              var tarde = new Date(l.proxima_accion_vence).getTime() < ahora;
              var e = etapaPorId(l.etapa_id);
              return '<tr><td><a class="card-name" href="#/lead/' + esc(l.id) + '">' + esc(l.nombre) + '</a></td>' +
                '<td>' + esc(l.proxima_accion || 'Seguimiento') + '</td>' +
                '<td' + (tarde ? ' class="late"' : '') + '>' + (tarde ? '<span class="late">Vencido · </span>' : '') + esc(fmtFecha(l.proxima_accion_vence)) + '</td>' +
                '<td>' + esc(avatarDe(l.responsable_id).nombre) + '</td>' +
                '<td>' + esc(e ? e.nombre : '') + '</td></tr>';
            }).join('') + '</tbody></table></div>'
          : '<p class="empty">No hay seguimientos programados.</p>') +
        (sin ? '<p class="sub">' + sin + ' lead' + (sin === 1 ? '' : 's') + ' abierto' + (sin === 1 ? '' : 's') + ' sin próxima acción programada.</p>' : '') +
      '</section>';
  }

  /* ------------------------------------------------------------------
     Tiempo real
     ------------------------------------------------------------------ */
  function suscribir() {
    var filtro = 'cliente_id=eq.' + S.perfil.cliente_id;
    S.canal = sb.channel('crm-' + S.perfil.cliente_id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'leads', filter: filtro }, function () {
        clearTimeout(S.timer);
        S.timer = setTimeout(function () {
          recargarLeads().then(refrescarVista).catch(function () { /* se reintenta con el próximo cambio */ });
        }, 400);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'eventos', filter: filtro }, function () {
        if (S.vista === 'ficha') cargarTimeline();
      })
      .subscribe();
  }

  /* ------------------------------------------------------------------
     Eventos de la interfaz
     ------------------------------------------------------------------ */
  document.addEventListener('click', function (e) {
    // Clic en el cuerpo de una tarjeta: abre la ficha (el nombre ya es un enlace)
    var tarjeta = e.target.closest('.card');
    if (tarjeta && !e.target.closest('a,button')) { location.hash = '#/lead/' + tarjeta.getAttribute('data-lead'); return; }

    var b = e.target.closest('[data-action]');
    if (!b) return;
    var a = b.getAttribute('data-action');
    var l = S.leadId ? leadPorId(S.leadId) : null;

    if (a === 'logout') cerrarSesion();
    else if (a === 'reintentar') arrancar();
    else if (a === 'cerrar-modal') $('#modal').close();
    else if (a === 'nuevo-lead') modalNuevoLead();
    else if (a === 'toggle-perdidos') { S.filtro.perdidos = !S.filtro.perdidos; b.setAttribute('aria-pressed', S.filtro.perdidos); renderBoard(); }
    else if (a === 'marcar-ganado' && l) modalGanado(l);
    else if (a === 'marcar-perdido' && l) modalPerdido(l);
    else if (a === 'reabrir' && l) { var p = primeraEtapa(); if (p) actualizarLead(l.id, { etapa_id: p.id, motivo_perdida: null }, 'Lead reabierto'); }
    else if (a === 'toggle-caliente' && l) actualizarLead(l.id, { caliente: !l.caliente });
    else if (a === 'marcar-contactado' && l) {
      actualizarLead(l.id, { ultimo_contacto: new Date().toISOString() }, 'Marcado como contactado')
        .then(function (r) { if (r) registrarEvento(l.id, 'mensaje', 'Primer contacto realizado', null).then(cargarTimeline); });
    }
    else if (a === 'completar-accion' && l) {
      var texto = l.proxima_accion || 'Seguimiento';
      actualizarLead(l.id, { proxima_accion: null, proxima_accion_vence: null, ultimo_contacto: new Date().toISOString() }, 'Acción completada')
        .then(function (r) {
          if (r) registrarEvento(l.id, 'seguimiento', 'Seguimiento completado', texto).then(cargarTimeline);
          var box = $('#f-next'); if (box) box.dataset.lead = '';
          renderFichaHead();
        });
    }
  });

  document.addEventListener('input', function (e) {
    if (e.target.id === 'f-q') { S.filtro.q = e.target.value; renderBoard(); }
  });

  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.id === 'f-origen') { S.filtro.origen = t.value; renderBoard(); }
    else if (t.id === 'f-resp') { S.filtro.resp = t.value; renderBoard(); }
    else if (t.id === 'f-etapa' && S.leadId) {
      var l = leadPorId(S.leadId);
      if (l) { t.blur(); moverLead(l.id, t.value); if (etapaPorId(t.value) && etapaPorId(t.value).tipo === 'perdida') renderFichaHead(); }
    }
  });

  document.addEventListener('submit', function (e) {
    var f = e.target;
    var l = S.leadId ? leadPorId(S.leadId) : null;
    if (f.id === 'f-nota-form' && l) {
      e.preventDefault();
      var txt = String(f.nota.value || '').trim();
      if (!txt) return;
      var nombre = S.perfil.nombre;
      registrarEvento(l.id, 'nota', 'Nota de ' + nombre, txt).then(function () {
        f.nota.value = '';
        cargarTimeline();
      }).catch(function (err) { toast(msgError(err), true); });
    } else if (f.id === 'f-next-form' && l) {
      e.preventDefault();
      var accion = vacioANull(f.accion.value);
      var vence = f.vence.value ? new Date(f.vence.value).toISOString() : null;
      if (!accion && !vence) return toast('Escribí qué hay que hacer o elegí una fecha.', true);
      actualizarLead(l.id, { proxima_accion: accion, proxima_accion_vence: vence }, 'Próxima acción guardada').then(function (r) {
        if (r) registrarEvento(l.id, 'seguimiento', 'Próxima acción programada', (accion || 'Seguimiento') + (vence ? ' · ' + fmtFecha(vence) : '')).then(cargarTimeline);
        var box = $('#f-next'); if (box) box.dataset.lead = '';
        renderFichaHead();
      });
    } else if (f.id === 'f-data-form' && l) {
      e.preventDefault();
      var nom = String(f.nombre.value || '').trim();
      if (!nom) return toast('El nombre no puede quedar vacío.', true);
      var vf = f.valor_final.value === '' ? null : Number(f.valor_final.value);
      actualizarLead(l.id, {
        nombre: nom,
        telefono: vacioANull(f.telefono.value),
        interes: vacioANull(f.interes.value),
        valor_estimado: Number(f.valor.value || 0),
        valor_final: vf,
        responsable_id: vacioANull(f.responsable.value),
        campana_id: vacioANull(f.campana.value),
        etiquetas: f.etiquetas.value.split(',').map(function (x) { return x.trim(); }).filter(Boolean)
      }, 'Cambios guardados');
    }
  });

  // Arrastrar y soltar
  document.addEventListener('dragstart', function (e) {
    var c = e.target.closest && e.target.closest('.card');
    if (!c) return;
    S.dragId = c.getAttribute('data-lead');
    c.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', S.dragId);
  });
  document.addEventListener('dragend', function (e) {
    var c = e.target.closest && e.target.closest('.card');
    if (c) c.classList.remove('dragging');
    S.dragId = null;
    var over = document.querySelectorAll('.col.over');
    for (var i = 0; i < over.length; i++) over[i].classList.remove('over');
  });
  document.addEventListener('dragover', function (e) {
    var col = e.target.closest && e.target.closest('.col');
    if (!col || !S.dragId) return;
    e.preventDefault();
    col.classList.add('over');
  });
  document.addEventListener('dragleave', function (e) {
    var col = e.target.closest && e.target.closest('.col');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('over');
  });
  document.addEventListener('drop', function (e) {
    var col = e.target.closest && e.target.closest('.col');
    if (!col || !S.dragId) return;
    e.preventDefault();
    col.classList.remove('over');
    moverLead(S.dragId, col.getAttribute('data-etapa'));
  });

  window.addEventListener('hashchange', ruta);

  iniciar();
})();
