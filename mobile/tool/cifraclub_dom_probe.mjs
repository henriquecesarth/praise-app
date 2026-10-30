// Local, read-only DevTools inspection of the existing Android probe WebView.
// No origin fetch, cookies, request headers or broad HTML capture.
const target = 'https://www.cifraclub.com.br/projeto-sola/glorificar/';
const convert = process.argv.includes('--convert');
const pages = await (await fetch('http://127.0.0.1:9223/json', {
  signal: AbortSignal.timeout(3000),
})).json();
const page = pages.find(item => item.type === 'page' && item.url === target);
if (!page) throw new Error('Expected Android WebView document is not available');
const socket = new WebSocket(page.webSocketDebuggerUrl);
const deadline = setTimeout(() => { socket.close(); process.exitCode = 1; }, 10000);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});
const expression = `(() => {
  if (location.href !== ${JSON.stringify(target)}) throw Error('Unexpected document');
  const pres = [...document.querySelectorAll('pre')];
  const describe = node => node ? {tag:node.tagName,id:node.id,class:node.className} : null;
  const labels = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let count=0, node;
  while ((node=walker.nextNode()) && count++ < 50000) {
    if (/^\\s*(?:tom|tom original|capotraste|vers[aã]o)\\s*:?\\s*$/i.test(node.textContent)) {
      labels.push({label:node.textContent.trim(),parent:describe(node.parentElement),
        text:node.parentElement.textContent.trim().slice(0,160),
        outer_text:node.parentElement.parentElement?.textContent.trim().slice(0,160)});
    }
  }
  const inspection = {
    url:location.href, title:document.title, labels,
    headings:[...document.querySelectorAll('h1,h2')].slice(0,6).map(n=>({...describe(n),text:n.textContent.trim().slice(0,120)})),
    artist_links:[...document.querySelectorAll('a[href="/projeto-sola/"]')].slice(0,3).map(n=>({...describe(n),text:n.textContent.trim()})),
    pre:pres.map(n=>({node:describe(n),parent:describe(n.parentElement),grandparent:describe(n.parentElement.parentElement),
      characters:n.textContent.length,lines:n.textContent.split('\\n').length,
      child_tags:[...new Set([...n.querySelectorAll('*')].map(x=>x.tagName))],
      chord_nodes:n.querySelectorAll('b').length,
      tab_rows:n.textContent.split('\\n').filter(x=>/^\\s*[eBGDAE]\\|/.test(x)).length}))
  };
  if (${convert}) {
    if (document.querySelector('#challenge-form,.g-recaptcha,iframe[src*="captcha"]')) throw Error('Access restricted');
    if (pres.length!==1 || document.querySelectorAll('h1').length!==1) throw Error('Ambiguous musical structure');
    if ([...pres[0].querySelectorAll('*')].some(n=>!['DIV','B','SPAN'].includes(n.tagName))) throw Error('Unverified musical markup');
    const artist=document.querySelectorAll('a[href="/projeto-sola/"]');
    if (artist.length!==1) throw Error('Ambiguous artist');
    const keyLabels=[...document.querySelectorAll('span')].filter(n=>/^Tom:\\s*$/.test(n.textContent.trim()));
    const keys=keyLabels.map(n=>n.parentElement.textContent.trim().match(/^Tom:\\s*([A-G][#b]?(?:m|maj|min)?)$/)?.[1]).filter(Boolean);
    if (keys.length!==1) throw Error('Missing or ambiguous explicit key');
    const escape=text=>text.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
    const raw=pres[0].textContent;
    // Projection only: preserve source text/spacing and supply the existing parser's selectors.
    // No chord/lyric interpretation here; no cookies, script or unrelated DOM is exported.
    return {raw, musical_html:'<h1 class="t1">'+escape(document.querySelector('h1').textContent.trim())+
      '</h1><h2 class="t3">'+escape(artist[0].textContent.trim())+'</h2><div id="cifra_tom">Tom: '+
      escape(keys[0])+'</div><div class="cifra_cnt"><pre>'+escape(raw)+'</pre></div>'};
  }
  return inspection;
})()`;
try {
  const response = await new Promise((resolve, reject) => {
    socket.addEventListener('message', event => {
      const data = JSON.parse(event.data);
      if (data.id === 1) resolve(data);
    });
    socket.addEventListener('error', reject, { once: true });
    socket.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,returnByValue:true}}));
  });
  if (response.error || response.result.exceptionDetails) throw new Error('DOM inspection failed');
  const value = response.result.result.value;
  if (convert) {
    const imported = await import('../../backend/src/features/smart_chords/cifraclub_html_parser.ts');
    const parse = imported.parseCifraClubHtml ?? imported.default?.parseCifraClubHtml;
    const result = parse(value.musical_html, target);
    const sourceTabs = value.raw.split('\n').filter(row => /^\s*[eBGDAE]\|/.test(row));
    const parsedTabs = result.lines.filter(row => row.kind === 'tablature').map(row => row.text);
    console.log(JSON.stringify({source_url:target,parser:'existing TypeScript parseCifraClubHtml, unchanged',
      projection:'musical text + explicit metadata only, in memory; no library write',
      title:result.draft.title,artist:result.draft.artist_name,key:result.draft.original_key,
      content_characters:result.draft.content.length,source_lines:result.lines.length,
      warnings:result.draft.warnings.map(w=>w.code),requires_manual_paste:result.draft.requires_manual_paste,
      checks:{intro:/\[Intro\]/i.test(result.draft.content),interlude:/interl[uú]dio/i.test(result.draft.content),
        Eb_G:result.draft.content.includes('Eb/G'),Ab_Bb:result.draft.content.includes('Ab/Bb'),
        original_text_preserved:result.draft.original_text===value.raw,
        lyric_lines:result.lines.filter(row=>row.kind==='lyrics').length,
        chord_or_progression_lines:result.lines.filter(row=>['chords','progression'].includes(row.kind)).length,
        source_tab_rows:sourceTabs.length,parsed_tab_rows:parsedTabs.length,
        complete_six_string_groups:sourceTabs.length > 0 && sourceTabs.length % 6 === 0 &&
          sourceTabs.every((row,index)=>row.trimStart()[0].toUpperCase()===['E','B','G','D','A','E'][index%6]),
        tabs_preserved:JSON.stringify(sourceTabs)===JSON.stringify(parsedTabs)}},null,2));
  } else { console.log(JSON.stringify(value, null, 2)); }
} finally { clearTimeout(deadline); socket.close(); }
