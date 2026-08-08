(function(){
  function install(){
    if(!window.luaparse || window.luaparse.__lrpConstFix) return false;
    var LP = window.luaparse, orig = LP.parse;
    LP.parse = function(src, opts){
      if (typeof src === "string") {
        src = src.replace(/\blocal\s+function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/g, "$1 = function(");
      }
      return orig.call(LP, src, opts);
    };
    LP.__lrpConstFix = true;
    return true;
  }
  if (!install()) { var n=0,t=setInterval(function(){ if(install()||++n>200)clearInterval(t); },20); }
})();
