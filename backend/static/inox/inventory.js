(() => {
  const formatDates = () => document.querySelectorAll('.inv-source time').forEach(node => {
    const date = new Date(node.dateTime);
    if (!Number.isNaN(date.valueOf())) node.textContent = new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
  });
  function renderInventory() {
  const element = document.getElementById('inv-chart-data');
  if (!element) return;
  const data = JSON.parse(element.textContent);
  const colors = ['#244e7a', '#3d9388', '#d3a464', '#b95462', '#a9b7c7'];
  const make = (tag, className, text) => { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; };
  const category = document.getElementById('inv-kind-chart');
  const maximum = Math.max(...data.kinds.map(row => row.value), 1);
  data.kinds.forEach((row, index) => {
    const outer = make('div', 'inv-bar-row');
    const track = make('div', 'inv-bar-track');
    const fill = make('div', 'inv-bar-fill');
    fill.style.width = `${row.value / maximum * 100}%`; fill.style.background = colors[index];
    track.append(fill); outer.append(make('span', '', row.label), track, make('strong', '', row.value)); category.append(outer);
  });
  const svg = (tag, attributes = {}) => { const node = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value); return node; };
  const stateRoot = document.getElementById('inv-state-chart');
  const stateColors = {'Disponible':'#3d9388','Reponer':'#b95462','Revisar saldo':'#d79a4e','Por contar':'#c8d2de','Sin mínimo':'#8196ac'};
  const entries = Object.entries(data.states);
  const total = entries.reduce((value, row) => value + row[1], 0);
  const ring = svg('svg', {viewBox:'0 0 140 140',class:'inv-ring',role:'img','aria-label':'Estados de los saldos por artículo y ubicación'});
  ring.append(svg('circle',{cx:70,cy:70,r:51,stroke:'#edf1f6'}));
  let offset = 0;
  const circumference = 2 * Math.PI * 51;
  const legend = make('div','inv-state-legend');
  entries.forEach(([label, count]) => {
    const length = total ? count / total * circumference : 0;
    ring.append(svg('circle',{cx:70,cy:70,r:51,stroke:stateColors[label] || '#8196ac','stroke-dasharray':`${length} ${circumference-length}`,'stroke-dashoffset':-offset,transform:'rotate(-90 70 70)'})); offset += length;
    const row = make('div','inv-legend-row'); const dot = make('i',''); dot.style.background=stateColors[label] || '#8196ac'; row.append(dot,make('span','',label),make('strong','',count)); legend.append(row);
  });
  const center = svg('text',{x:70,y:75,'text-anchor':'middle',fill:'#243f5d','font-size':25,'font-weight':600}); center.textContent=total; ring.append(center);
  stateRoot.append(ring,legend);
  const monthRoot = document.getElementById('inv-month-chart');
  if (!data.monthly.length) {
    const empty=make('div','inv-empty'); empty.append(make('strong','','Aquí verás el ritmo de tu inventario.'),make('span','','Registra la primera entrada, salida o traslado en la hoja para comenzar.')); monthRoot.append(empty);
  } else {
    const points = data.monthly.slice(-12);
    const series = [{name:'Entradas',color:colors[1],value:row=>row.Entrada},{name:'Salidas',color:colors[3],value:row=>row.Salida},{name:'Traslados',color:colors[0],value:row=>row.Traslado},{name:'Ajustes',color:colors[2],value:row=>row['Ajuste +']+row['Ajuste -']}];
    const width=1000,height=210,left=36,right=20,top=15,bottom=35;
    const yMax=Math.max(...points.flatMap(row=>series.map(s=>s.value(row))),1);
    const chart=svg('svg',{viewBox:`0 0 ${width} ${height}`,role:'img','aria-label':'Número mensual de entradas, salidas, traslados y ajustes'});
    for(let i=0;i<=4;i++) {const y=top+(height-top-bottom)*i/4;chart.append(svg('line',{x1:left,y1:y,x2:width-right,y2:y,stroke:'#edf1f6'}));const label=svg('text',{x:left-8,y:y+4,'text-anchor':'end',fill:'#8494a6','font-size':10});label.textContent=(yMax*(4-i)/4).toFixed(yMax<4?1:0);chart.append(label);}
    const xAt=index=>points.length===1?(width+left-right)/2:left+index*(width-left-right)/(points.length-1);
    points.forEach((row,index)=>{const label=svg('text',{x:xAt(index),y:height-8,'text-anchor':'middle',fill:'#8494a6','font-size':10});label.textContent=row.label;chart.append(label);});
    const legend=make('div','inv-chart-legend');
    series.forEach(s=>{const coordinates=points.map((row,index)=>`${xAt(index)},${top+(height-top-bottom)*(1-s.value(row)/yMax)}`).join(' ');chart.append(svg('polyline',{points:coordinates,fill:'none',stroke:s.color,'stroke-width':2}));points.forEach((row,index)=>chart.append(svg('circle',{cx:xAt(index),cy:top+(height-top-bottom)*(1-s.value(row)/yMax),r:3,fill:s.color})));const label=make('div','inv-legend-row');const dot=make('i','');dot.style.background=s.color;label.append(dot,make('span','',s.name));legend.append(label);});
    monthRoot.append(chart,legend);
  }
  const search = document.getElementById('inv-search');
  const normalize = text => text.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  search?.addEventListener('input',()=>{let visible=0;const query=normalize(search.value);for(const row of document.querySelectorAll('#inv-stock-rows tr')){row.hidden=!normalize(row.textContent).includes(query);if(!row.hidden)visible++;}document.getElementById('inv-no-results').hidden=visible>0;});
  formatDates();
  }
  renderInventory();

  const shell = document.querySelector('.inv-shell');
  const configuration = document.getElementById('inv-sync-data');
  const status = document.getElementById('inv-sync-status');
  const refreshForm = document.getElementById('inv-refresh-form');
  if (!shell || !configuration || !status || !refreshForm) return;
  const initial = JSON.parse(configuration.textContent);
  if (!initial.enabled) return;
  let revision = initial.revision;
  let timer;
  let running = false;
  let stopped = false;

  function showStatus(state, message) {
    status.dataset.state = state;
    status.querySelector('strong').textContent = message;
    status.querySelector('a').hidden = state !== 'session';
  }
  function sessionEnded() {
    stopped = true;
    clearTimeout(timer);
    showStatus('session', 'Tu sesión terminó. Inicia sesión para continuar actualizando el inventario.');
  }
  function checkResponse(response) {
    if (response.status === 401 || response.status === 403) {
      sessionEnded();
      throw new Error('session');
    }
    if (!response.ok || response.redirected) throw new Error('network');
    return response;
  }
  async function updateData(signal, automatic) {
    // Keep an unfinished analysis, search, focus and scroll while replacing the
    // rendered data. Only the submitted URL is used to recalculate a result.
    const response = checkResponse(await fetch(window.location.href, {
      credentials: 'same-origin', cache: 'no-store', signal,
      headers: { Accept: 'application/json, text/html', ...(automatic ? { 'X-Inox-Automatic': '1' } : {}) },
    }));
    const page = new DOMParser().parseFromString(await response.text(), 'text/html');
    const next = page.getElementById('inv-data');
    const nextConfiguration = page.getElementById('inv-sync-data');
    if (!next || !nextConfiguration) throw new Error('render');
    const old = document.getElementById('inv-data');
    const fields = [...old.querySelectorAll('input, select')].map(field => ({
      name: field.name || field.id, value: field.value, focused: field === document.activeElement,
      start: field.selectionStart, end: field.selectionEnd,
    }));
    const x = window.scrollX, y = window.scrollY;
    old.replaceWith(next);
    renderInventory();
    const remaining = [...fields];
    for (const field of next.querySelectorAll('input, select')) {
      const index = remaining.findIndex(saved => saved.name === (field.name || field.id));
      if (index < 0) continue;
      const saved = remaining.splice(index, 1)[0];
      field.value = saved.value;
      if (saved.focused) {
        field.focus({ preventScroll: true });
        if (typeof saved.start === 'number' && typeof field.setSelectionRange === 'function') {
          field.setSelectionRange(saved.start, saved.end);
        }
      }
    }
    next.querySelector('#inv-search')?.dispatchEvent(new Event('input'));
    window.scrollTo(x, y);
    revision = JSON.parse(nextConfiguration.textContent).revision;
  }
  async function refresh(automatic = true) {
    clearTimeout(timer);
    if (running || stopped || (automatic && document.hidden)) return;
    running = true;
    let delay = initial.interval || 60;
    const button = refreshForm.querySelector('button');
    button.disabled = true;
    if (!automatic) showStatus('checking', 'Comprobando Google Sheets…');
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 50000);
    try {
      const response = checkResponse(await fetch(shell.dataset.refreshUrl, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
        headers: { Accept: 'application/json', 'X-CSRFToken': refreshForm.querySelector('[name=csrfmiddlewaretoken]').value,
          ...(automatic ? { 'X-Inox-Automatic': '1' } : {}) },
      }));
      const result = await response.json();
      delay = result.busy ? 5 : Math.max(5, result.retryAfter || delay);
      if (!result.enabled) stopped = true;
      if (result.revision !== revision) await updateData(controller.signal, automatic);
      document.querySelectorAll('.inv-source time').forEach(node => { node.dateTime = result.fetchedAt; });
      formatDates();
      showStatus(result.state, result.busy ? 'Actualizando Google Sheets…' : result.message);
    } catch {
      if (!stopped) showStatus('error', 'No se pudo comprobar la actualización. Conservamos los últimos datos y volveremos a intentarlo.');
    } finally {
      clearTimeout(deadline);
      running = false;
      button.disabled = stopped;
      if (!stopped && !document.hidden) timer = setTimeout(() => refresh(), delay * 1000);
    }
  }
  refreshForm.addEventListener('submit', event => { event.preventDefault(); refresh(false); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(timer);
    else refresh();
  });
  refresh();
})();
