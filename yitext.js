/*!
 * 易文本 YiText —— 轻量中文标记语言解析库
 * 版本：0.5.0
 *
 * 用法：
 *   浏览器：<script src="yitext.js"></script>
 *           document.getElementById('out').innerHTML = YiText.parse(text);
 *   Node：  const YiText = require('./yitext.js');
 *           const html = YiText.parse(text);
 *
 * API：
 *   YiText.parse(src, options)
 *     - src:     易文本源码字符串（或 .ywb 文件内容）
 *     - options:
 *         css:    true  时，在返回结果最前面注入一份 <style> 默认样式（适合一次性渲染）
 *                 false（默认）时，只返回纯 HTML，样式由调用方自行引入 YiText.css
 *     - 返回：HTML 字符串
 *   YiText.css     默认样式字符串（不含 <style> 标签），可写入你的样式表或 <style>
 *   YiText.version 版本号
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YiText = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const NUM = { yi:1, er:2, san:3, si:4, wu:5, liu:6, qi:7, ba:8, jiu:9, shi:10 };
  const TOKENS = {
    jc:'strong', yy:'blockquote', xt:'em', xhx:'u', gl:'mark', scx:'s', sc:'s',
    tsk:'tip', hndm:'code', sb:'sup', sjb:'sup', xb:'sub', xjb:'sub',
    jzong:'center', zj:'center', jzuo:'left', kz:'left', jyou:'right', ky:'right',
    lj:'link', tplj:'image', tclj:'image', zplj:'image', splj:'video', yplj:'audio', fjlj:'file', jz:'footnote',
    wxlb:'ul', d:'ul', yxlb:'ol', rw:'task',
    fgx:'hr', hh:'br', fy:'page', ml:'toc', sj:'time',
    zdnr:'details', zd:'details', dmk:'codeblock', dm:'codeblock'
  };
  const TIP_TYPES = ['info','success','warn','danger'];
  const TIP_LABEL = { info:'提示', success:'成功', warn:'注意', danger:'警告' };

  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}
  function safeUrl(u){u=String(u).trim(); if(/^\s*javascript:/i.test(u)) return '#'; return esc(u);}
  function splitPair(s){s=String(s); const i=s.indexOf('|'); if(i<0) return [s.trim(),s.trim()]; return [s.slice(0,i).trim(), s.slice(i+1).trim()];}
  function isMdSep(s){ return /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/.test(s); }
  function isMdRow(s){ return /^\s*\|.*\|\s*$/.test(s); }
  function splitMdCells(s){ s=String(s).trim().replace(/^\|/,'').replace(/\|$/,''); return s.split('|').map(c=>c.trim()); }
  function parseMdAligns(sep){ return splitMdCells(sep).map(c=>{ if(/^:.*:$/.test(c)) return 'center'; if(/:$/.test(c)) return 'right'; return 'left'; }); }
  const V_PUNCT = '，。！？、；：…—·‘’“”（）《》〈〉「」『』【】〔〕';
  function isPunct(ch){ return V_PUNCT.indexOf(ch)>=0 || /[\u3000-\u303f\uff00-\uffef]/.test(ch); }
  function isCJK(ch){ return /[\u4e00-\u9fff]/.test(ch); }
  function splitVerticalCells(text){
    const cells=[];
    let cur=null;
    const isLatinNum = ch => /[0-9A-Za-z]/.test(ch);
    for(const ch of text){
      if(ch===' '||ch==='\t'){ continue; }
      if(isPunct(ch)){
        if(cur===null){ cur={c:'',p:''}; cells.push(cur); }
        cur.p+=ch;
      } else if(isLatinNum(ch) && cur && cur.c!=='' && isLatinNum(cur.c)){
        cur.c+=ch;
      } else {
        cur={c:ch,p:''}; cells.push(cur);
      }
    }
    return cells;
  }
  function renderVertical(lines, direction){
    if(!lines.length) return '';
    const dirClass = direction==='lr' ? 'yi-v-lr' : 'yi-v-rl';
    let s='<div class="yi-vertical '+dirClass+'">';
    for(const line of lines){
      const cells=splitVerticalCells(line);
      s+='<div class="yi-vcol">';
      for(const cell of cells){
        const num = cell.c!=='' && !isCJK(cell.c);
        s+='<span class="yi-vcell'+(num?' yi-vnum':'')+'">';
        if(cell.c) s+='<span class="yi-vchar">'+esc(cell.c)+'</span>';
        if(cell.p) s+='<span class="yi-vpunct">'+esc(cell.p)+'</span>';
        s+='</span>';
      }
      s+='</div>';
    }
    s+='</div>';
    return s;
  }
  function renderToc(h){
    if(!h.length) return '<div class="toc toc-empty">（暂无标题）</div>';
    let s='<nav class="toc"><div class="toc-title">目录</div><ul class="toc-list">';
    for(const it of h){ s+='<li class="toc-lvl-'+it.level+'"><a href="#'+it.id+'">'+esc(it.text)+'</a></li>'; }
    s+='</ul></nav>'; return s;
  }

  function parseYi(src){
    src=String(src==null?'':src);
    const lines=src.replace(/\r\n/g,'\n').split('\n');
    let out='';
    let inCode=false,codeLang='',codeBuf=[];
    let inDetails=false,detSummary='',detBuf=[];
    let listType=null,listBuf=[];
    let headings=[];
    let footnotes=[],fnCount=0;
    let paraBuf=[];
    let inVertical=false, vDirection='rl', vBuf=[];
    function flushPara(){ if(paraBuf.length){ out+='<p>'+paraBuf.map(esc).join('<br>')+'</p>'; paraBuf=[]; } }
    function flushList(){ if(listType){
      if(listType==='task'){
        out+='<ul class="yi-list yi-task-list">'+listBuf.map(li=>'<li class="yi-task"><input type="checkbox" disabled> '+esc(li)+'</li>').join('')+'</ul>';
      } else {
        out+='<'+listType+' class="yi-list">'+listBuf.map(li=>'<li>'+esc(li)+'</li>').join('')+'</'+listType+'>';
      }
      listType=null; listBuf=[];
    } }
    function flushDetails(){ if(inDetails){ out+='<details class="yi-details"><summary>'+esc(detSummary)+'</summary><div class="details-body">'+detBuf.map(esc).join('<br>')+'</div></details>'; inDetails=false; detBuf=[]; } }
    function flushVertical(){ if(inVertical){ out+=renderVertical(vBuf, vDirection); inVertical=false; vDirection='rl'; vBuf=[]; } }
    function flushCode(){ if(inCode){ out+='<pre class="yi-codeblock'+(codeLang?' lang-'+esc(codeLang):'')+'"><code>'+esc(codeBuf.join('\n'))+'</code></pre>'; inCode=false; codeBuf=[]; codeLang=''; } }
    function flushAll(){ flushPara(); flushList(); flushDetails(); flushCode(); flushVertical(); }
    for(let idx=0; idx<lines.length; idx++){
      const raw=lines[idx];
      const line=raw.replace(/\s+$/,'');
      if(inCode){ if(line.trim()==='dmk'||line.trim()==='dm'){ flushCode(); continue; } codeBuf.push(raw); continue; }
      if(inDetails){ if(line.trim()==='zdnr'||line.trim()==='zd'){ flushDetails(); continue; } detBuf.push(raw); continue; }
      if(inVertical){
        const vt=line.trim();
        if(vt==='heng'){ flushVertical(); continue; }
        vBuf.push(line);
        continue;
      }
      if(line.trim()===''){ flushPara(); flushList(); continue; }
      const trimmed=line.trim();
      if(trimmed==='shu'||trimmed.startsWith('shu ')){
        const arg=(trimmed==='shu'?'':trimmed.slice(3).trim());
        flushPara(); flushList(); flushDetails(); flushCode();
        vDirection = arg==='zuo' ? 'lr' : 'rl';
        inVertical=true; vBuf=[];
        continue;
      }
      if(trimmed==='---'){ flushPara(); flushList(); out+='<hr class="yi-hr">'; continue; }
      if(trimmed==='==='){ flushPara(); flushList(); out+='<hr class="yi-hr yi-hr-double">'; continue; }
      if(trimmed==='···'||trimmed==='...'){ flushPara(); flushList(); out+='<hr class="yi-hr yi-hr-dashed">'; continue; }
      if(trimmed==='～～～'||trimmed==='~~~'){ flushPara(); flushList(); out+='<hr class="yi-hr yi-hr-wavy">'; continue; }
      if(isMdRow(trimmed) && isMdSep((lines[idx+1]||'').trim())){
        flushPara(); flushList();
        const header=splitMdCells(trimmed);
        const aligns=parseMdAligns((lines[idx+1]||'').trim());
        let last=idx+1;
        const dataRows=[];
        while(last+1<lines.length && isMdRow((lines[last+1]||'').trim())){
          last++;
          dataRows.push(splitMdCells(lines[last].trim()));
        }
        let t='<table class="yi-table"><thead><tr>';
        header.forEach((c,i)=>{ t+='<th'+(aligns[i]&&aligns[i]!=='left'?' style="text-align:'+aligns[i]+'"':'')+'>'+esc(c)+'</th>'; });
        t+='</tr></thead><tbody>';
        for(const row of dataRows){
          t+='<tr>';
          for(let i=0;i<header.length;i++){
            const c=row[i]!==undefined?row[i]:'';
            t+='<td'+(aligns[i]&&aligns[i]!=='left'?' style="text-align:'+aligns[i]+'"':'')+'>'+esc(c)+'</td>';
          }
          t+='</tr>';
        }
        t+='</tbody></table>';
        out+=t;
        idx=last;
        continue;
      }
      const m=line.match(/^(\S+)\s+([\s\S]*)$/);
      let token=null,rest='';
      if(m){ token=m[1]; rest=m[2]; } else { token=line.trim(); rest=''; }
      const ysM=token.match(/^ys(.+)$/);
      if(ysM){
        const cv=ysM[1];
        let style='';
        if(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(cv)) style='color:'+cv;
        else if(/^\d{1,3},\d{1,3},\d{1,3}$/.test(cv)) style='color:rgb('+cv+')';
        else if(/^rgba?\([^)]+\)$/i.test(cv)) style='color:'+cv;
        flushPara(); flushList();
        out+='<p class="yi-color"'+(style?' style="'+style+'"':'')+'>'+esc(rest)+'</p>';
        continue;
      }
      const zhM=token.match(/^zh(\d+)$/);
      if(zhM){
        const n=parseInt(zhM[1],10);
        const size = n===1?'1.25em' : n===2?'1.6em' : (1+0.35*n)+'em';
        flushPara(); flushList();
        out+='<p class="yi-size" style="font-size:'+size+'">'+esc(rest)+'</p>';
        continue;
      }
      if(NUM[token]!==undefined){
        flushPara(); flushList();
        const n=NUM[token], lvl=Math.min(n,6), hid='yi-h-'+headings.length;
        headings.push({level:lvl,id:hid,text:rest});
        out+='<h'+lvl+' id="'+hid+'" class="yi-h yi-h'+lvl+'">'+esc(rest)+'</h'+lvl+'>';
        continue;
      }
      const type=TOKENS[token];
      if(type){
        flushPara();
        if(type!=='ul'&&type!=='ol'&&type!=='task') flushList();
        switch(type){
          case 'strong': out+='<p class="yi-strong"><strong>'+esc(rest)+'</strong></p>'; break;
          case 'blockquote': out+='<blockquote class="yi-quote">'+esc(rest)+'</blockquote>'; break;
          case 'em': out+='<p class="yi-em"><em>'+esc(rest)+'</em></p>'; break;
          case 'u': out+='<p class="yi-u"><u>'+esc(rest)+'</u></p>'; break;
          case 'mark': out+='<p class="yi-mark"><mark>'+esc(rest)+'</mark></p>'; break;
          case 's': out+='<p class="yi-s"><s>'+esc(rest)+'</s></p>'; break;
          case 'tip': { let r=rest,cls='info'; const tw=r.split(/\s+/)[0]; if(TIP_TYPES.includes(tw)){cls=tw; r=r.slice(tw.length).trim();} out+='<div class="yi-tip yi-tip-'+cls+'"><span class="tip-label">'+TIP_LABEL[cls]+'</span>'+esc(r)+'</div>'; break; }
          case 'code': out+='<p class="yi-code"><code class="yi-inline-code">'+esc(rest)+'</code></p>'; break;
          case 'sup': out+='<p class="yi-sup"><sup>'+esc(rest)+'</sup></p>'; break;
          case 'sub': out+='<p class="yi-sub"><sub>'+esc(rest)+'</sub></p>'; break;
          case 'center': out+='<div class="yi-align yi-center">'+esc(rest)+'</div>'; break;
          case 'left': out+='<div class="yi-align yi-left">'+esc(rest)+'</div>'; break;
          case 'right': out+='<div class="yi-align yi-right">'+esc(rest)+'</div>'; break;
          case 'link': { const p=splitPair(rest); out+='<a class="yi-link" href="'+safeUrl(p[1])+'" target="_blank" rel="noopener">'+esc(p[0])+'</a>'; break; }
          case 'image': { const p=splitPair(rest); out+='<figure class="yi-figure"><img src="'+safeUrl(p[1])+'" alt="'+esc(p[0])+'"><figcaption>'+esc(p[0])+'</figcaption></figure>'; break; }
          case 'video': { const p=splitPair(rest); out+='<div class="yi-media"><video src="'+safeUrl(p[1])+'" controls preload="metadata"></video></div>'; break; }
          case 'audio': { const p=splitPair(rest); out+='<div class="yi-media"><audio src="'+safeUrl(p[1])+'" controls preload="metadata"></audio></div>'; break; }
          case 'file': { const p=splitPair(rest); out+='<a class="yi-file" href="'+safeUrl(p[1])+'" target="_blank" rel="noopener">📎 '+esc(p[0])+'</a>'; break; }
          case 'footnote': { fnCount++; footnotes.push({n:fnCount,text:rest}); out+='<sup class="yi-fn"><a id="fnref'+fnCount+'" href="#fn'+fnCount+'">['+fnCount+']</a></sup>'; break; }
          case 'ul': if(listType&&listType!=='ul') flushList(); listType='ul'; listBuf.push(rest); break;
          case 'ol': if(listType&&listType!=='ol') flushList(); listType='ol'; listBuf.push(rest); break;
          case 'task': if(listType&&listType!=='task') flushList(); listType='task'; listBuf.push(rest); break;
          case 'hr': out+='<hr class="yi-hr">'; break;
          case 'br': out+='<div class="yi-br"></div>'; break;
          case 'page': out+='<div class="yi-page-break"><span>分页</span></div>'; break;
          case 'toc': out+=renderToc(headings); break;
          case 'time': out+='<span class="yi-time">'+esc(new Date().toLocaleString('zh-CN'))+'</span>'; break;
          case 'details': inDetails=true; detSummary=rest; break;
          case 'codeblock': inCode=true; codeLang=rest.trim(); break;
        }
        continue;
      }
      if(listType) flushList();
      paraBuf.push(line);
    }
    flushAll();
    if(footnotes.length){
      out+='<section class="yi-footnotes"><hr><div class="fn-title">脚注</div><ol>';
      for(const f of footnotes){ out+='<li id="fn'+f.n+'">'+esc(f.text)+' <a href="#fnref'+f.n+'" class="fn-back">↩</a></li>'; }
      out+='</ol></section>';
    }
    return out;
  }

  // 默认样式（自包含，不依赖任何主题变量）
  const CSS = [
    '.yi-doc{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif;line-height:1.7;color:#1f2328;}',
    '.yi-doc .yi-h{margin:1.2em 0 .6em;line-height:1.3;}',
    '.yi-doc .yi-h1{font-size:2em;}.yi-doc .yi-h2{font-size:1.6em;}.yi-doc .yi-h3{font-size:1.35em;}.yi-doc .yi-h4{font-size:1.15em;}.yi-doc .yi-h5{font-size:1em;}.yi-doc .yi-h6{font-size:.95em;}',
    '.yi-doc p{margin:.6em 0;}',
    '.yi-doc .yi-quote{border-left:4px solid #c9d1d9;padding:.4em 1em;color:#57606a;background:#f6f8fa;margin:.8em 0;}',
    '.yi-doc .yi-em em{font-style:italic;}',
    '.yi-doc .yi-u u{text-decoration:underline;}',
    '.yi-doc .yi-mark mark{background:#fff3a3;padding:0 .2em;}',
    '.yi-doc .yi-s s{text-decoration:line-through;color:#8b949e;}',
    '.yi-doc .yi-tip{border-radius:8px;padding:.6em .9em;margin:.8em 0;border-left:4px solid #0969da;background:#ddf4ff;}',
    '.yi-doc .yi-tip-warn{border-color:#bf8700;background:#fff8c5;}',
    '.yi-doc .yi-tip-success{border-color:#1a7f37;background:#dafbe1;}',
    '.yi-doc .yi-tip-danger{border-color:#cf222e;background:#ffebe9;}',
    '.yi-doc .yi-tip .tip-label{font-weight:700;margin-right:.5em;}',
    '.yi-doc .yi-code code,.yi-doc .yi-inline-code{background:#f6f8fa;border:1px solid #d0d7de;border-radius:4px;padding:.1em .4em;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em;}',
    '.yi-doc .yi-codeblock{background:#0d1117;color:#e6edf3;border-radius:8px;padding:1em;overflow:auto;}',
    '.yi-doc .yi-codeblock code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre;}',
    '.yi-doc .yi-sup sup,.yi-doc .yi-sub sub{font-size:.75em;}',
    '.yi-doc .yi-align{margin:.6em 0;}.yi-doc .yi-center{text-align:center;}.yi-doc .yi-left{text-align:left;}.yi-doc .yi-right{text-align:right;}',
    '.yi-doc .yi-link{color:#0969da;text-decoration:none;}.yi-doc .yi-link:hover{text-decoration:underline;}',
    '.yi-doc .yi-figure{margin:.8em 0;}.yi-doc .yi-figure img{max-width:100%;border-radius:8px;}.yi-doc .yi-figure figcaption{font-size:.85em;color:#57606a;text-align:center;margin-top:.3em;}',
    '.yi-doc .yi-media{margin:.8em 0;}.yi-doc .yi-media video,.yi-doc .yi-media audio{max-width:100%;}',
    '.yi-doc .yi-file{display:inline-block;background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;padding:.4em .8em;color:#1f2328;text-decoration:none;}',
    '.yi-doc .yi-list{padding-left:1.6em;margin:.6em 0;}',
    '.yi-doc .yi-task-list{list-style:none;padding-left:.2em;}',
    '.yi-doc .yi-task input{margin-right:.4em;vertical-align:middle;}',
    '.yi-doc .yi-table{border-collapse:collapse;width:100%;margin:.8em 0;font-size:.95em;overflow:hidden;border-radius:4px;}',
    '.yi-doc .yi-table th,.yi-doc .yi-table td{border:1px solid #d0d7de;padding:.5em .7em;text-align:left;}',
    '.yi-doc .yi-table thead th{background:#f6f8fa;font-weight:700;}',
    '.yi-doc .yi-table tbody tr:nth-child(even){background:#f6f8fa;}',
    '.yi-doc .yi-vertical{display:flex;flex-direction:row;margin:1em 0;line-height:1;overflow-x:auto;}',
    '.yi-doc .yi-vertical.yi-v-rl{justify-content:flex-end;}.yi-doc .yi-vertical.yi-v-lr{justify-content:flex-start;}',
    '.yi-doc .yi-vcol{display:flex;flex-direction:column;align-items:center;margin:0 .25em;}',
    '.yi-doc .yi-vcell{display:flex;flex-direction:column;align-items:center;}',
    '.yi-doc .yi-vchar{font-size:1.2em;line-height:1.2;}',
    '.yi-doc .yi-vcell.yi-vnum .yi-vchar{writing-mode:horizontal-tb;text-orientation:upright;letter-spacing:.05em;}',
    '.yi-doc .yi-vpunct{font-size:.75em;line-height:1;color:#57606a;}',
    '.yi-doc .yi-hr{border:none;border-top:1px solid #d0d7de;margin:1.2em 0;}',
    '.yi-doc .yi-hr-double{border-top:3px double #d0d7de;}',
    '.yi-doc .yi-hr-dashed{border-top:1px dashed #d0d7de;}',
    '.yi-doc .yi-hr-wavy{border:none;height:10px;background:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'40\' height=\'8\' viewBox=\'0 0 40 8\' preserveAspectRatio=\'none\'%3E%3Cpath d=\'M0 4 Q5 0 10 4 T20 4 T30 4 T40 4\' fill=\'none\' stroke=\'%238b949e\' stroke-width=\'1.5\'/%3E%3C/svg%3E") repeat-x center/auto 10px;}',
    '.yi-doc .yi-page-break{border-top:1px dashed #d0d7de;text-align:center;color:#8b949e;margin:1.2em 0;}',
    '.yi-doc .yi-page-break span{background:#fff;padding:0 .5em;position:relative;top:-.8em;}',
    '.yi-doc .yi-time{color:#57606a;font-size:.85em;}',
    '.yi-doc .yi-details{border:1px solid #d0d7de;border-radius:8px;padding:.4em .8em;margin:.8em 0;}',
    '.yi-doc .yi-details summary{cursor:pointer;font-weight:600;}',
    '.yi-doc .yi-details .details-body{margin-top:.5em;}',
    '.yi-doc .yi-color,.yi-doc .yi-size{margin:.6em 0;}',
    '.yi-doc .yi-footnotes{margin-top:2em;font-size:.9em;color:#57606a;}.yi-doc .yi-footnotes ol{padding-left:1.4em;}.yi-doc .yi-fn a{color:#0969da;}',
    '.yi-doc .toc{background:#f6f8fa;border:1px solid #d0d7de;border-radius:8px;padding:.6em 1em;margin:.8em 0;}',
    '.yi-doc .toc-title{font-weight:700;margin-bottom:.3em;}.yi-doc .toc-list{list-style:none;padding-left:0;margin:0;}',
    '.yi-doc .toc-list li{margin:.2em 0;}.yi-doc .toc-lvl-2{padding-left:1em;}.yi-doc .toc-lvl-3{padding-left:2em;}.yi-doc .toc-lvl-4{padding-left:3em;}.yi-doc .toc-lvl-5{padding-left:4em;}.yi-doc .toc-lvl-6{padding-left:5em;}'
  ].join('\n');

  function parse(src, options){
    options = options || {};
    const html = parseYi(src);
    if(options.css) return '<style>\n' + CSS + '\n</style>\n<div class="yi-doc">\n' + html + '\n</div>';
    return html;
  }

  return { parse: parse, css: CSS, version: '0.5.0' };
}));
