import '../../../core/errors/app_failure.dart';

/// URL authority is validated before any WebView is mounted or API call occurs.
Uri validateCifraClubCaptureUrl(String input) {
  final uri = Uri.tryParse(input);
  if (input.length > 1000 ||
      uri == null ||
      uri.scheme != 'https' ||
      !const ['www.cifraclub.com.br', 'cifraclub.com.br'].contains(uri.host) ||
      uri.userInfo.isNotEmpty ||
      uri.hasPort ||
      uri.hasQuery ||
      uri.hasFragment ||
      !RegExp(r'^/[a-z0-9-]+/[a-z0-9-]+/$').hasMatch(uri.path)) {
    throw const AppFailure(
      message:
          'Use um link HTTPS de artista/música do Cifra Club, sem parâmetros.',
      code: 'CIFRACLUB_INVALID_URL',
    );
  }
  return uri;
}

/// Structural projection only. The backend's existing TypeScript parser remains
/// the sole interpreter of musical text. No script, cookie or broad HTML export.
const cifraClubMusicalDomScript = r'''(() => {
  if (document.querySelector('#challenge-form,.g-recaptcha,iframe[src*="captcha"]') ||
      /access denied|just a moment|verify you are human|captcha|403 forbidden/i.test(document.title))
    return JSON.stringify({blocked:true});
  const pres=document.querySelectorAll('article pre,.cifra_cnt pre,pre.js-tab-content');
  if (pres.length!==1 || document.querySelectorAll('h1').length!==1)
    return JSON.stringify({ready:false});
  const pre=pres[0];
  if ([...pre.querySelectorAll('*')].some(n=>!['DIV','B','SPAN','BR'].includes(n.tagName)))
    return JSON.stringify({unsupported:true});
  const artistPath='/'+location.pathname.split('/').filter(Boolean)[0]+'/';
  const artists=[...document.querySelectorAll('a[href]')].filter(n=>n.getAttribute('href')===artistPath);
  const title=document.querySelector('h1').textContent.trim();
  const keys=[...document.querySelectorAll('span')].filter(n=>/^Tom:\s*$/.test(n.textContent.trim()))
    .map(n=>n.parentElement.textContent.trim().match(/^Tom:\s*([A-G][#b]?(?:m|maj|min)?)$/)?.[1]).filter(Boolean);
  const legacy=document.querySelector('#cifra_tom')?.textContent.trim().match(/^(?:Tom:\s*)?([A-G][#b]?(?:m|maj|min)?)$/)?.[1];
  if (!keys.length && legacy) keys.push(legacy);
  if (artists.length!==1 || !title || keys.length!==1) return JSON.stringify({ready:false});
  const explicitField=(label,pattern,selector)=>{
    const labels=[...document.querySelectorAll('span')].filter(n=>label.test(n.textContent.trim()));
    const legacy=document.querySelector(selector);
    const candidates=labels.map(n=>n.parentElement.textContent.trim());
    if (legacy?.textContent.trim()) candidates.push(legacy.textContent.trim());
    const parsed=candidates.map(text=>text.match(pattern)?.[1]);
    if (parsed.some(value=>value===undefined) || new Set(parsed).size>1) throw Error('Ambiguous explicit metadata');
    return parsed[0] || null;
  };
  let capo, original, version;
  try {
    capo=explicitField(/^(?:Capotraste|Capo):\s*$/i,/^(?:(?:Capotraste|Capo):\s*)?(\d{1,2})(?:\s*(?:ª|a|º|o)?\s*casa)?$/i,'#cifra_capo,.capotraste');
    original=explicitField(/^Tom original:\s*$/i,/^(?:Tom original:\s*)?([A-G][#b]?(?:m|maj|min)?)$/i,'#cifra_tom_original');
    version=explicitField(/^Vers[aã]o:\s*$/i,/^(?:Vers[aã]o:\s*)?(.{1,120})$/i,'#cifra_versao,.cifra_version');
    if (capo!==null && Number(capo)>24) throw Error('Invalid capo');
  } catch (_) { return JSON.stringify({unsupported:true}); }
  // BR conversion is structural; explicit source newlines/spaces are untouched.
  const copy=pre.cloneNode(true);
  copy.querySelectorAll('br').forEach(n=>n.replaceWith(document.createTextNode('\n')));
  const raw=copy.textContent;
  if (!raw.trim()) return JSON.stringify({ready:false});
  if (raw.length>90000) return JSON.stringify({oversized:true});
  const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
  const html='<h1 class="t1">'+esc(title)+'</h1><h2 class="t3">'+esc(artists[0].textContent.trim())+
    '</h2><div id="cifra_tom">Tom: '+esc(keys[0])+'</div>'+
    (capo!==null?'<div id="cifra_capo">Capotraste: '+esc(capo)+'</div>':'')+
    (original!==null?'<div id="cifra_tom_original">Tom original: '+esc(original)+'</div>':'')+
    (version!==null?'<span id="cifra_versao">'+esc(version)+'</span>':'')+
    '<div class="cifra_cnt"><pre>'+esc(raw)+'</pre></div>';
  if (html.length>100000) return JSON.stringify({oversized:true});
  return JSON.stringify({ready:true,html});
})()''';
