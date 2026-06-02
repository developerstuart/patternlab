// Curated highlight.js entry, bundled into an IIFE by build.mjs and inlined into
// index.html when `ui.code.highlight` is enabled. Only the languages the code
// view needs are registered, to keep the inlined bundle small.
import hljs from "highlight.js/lib/core";
import xml from "highlight.js/lib/languages/xml";
import css from "highlight.js/lib/languages/css";
import scss from "highlight.js/lib/languages/scss";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import handlebars from "highlight.js/lib/languages/handlebars";
import twig from "highlight.js/lib/languages/twig";

hljs.registerLanguage("xml", xml);
hljs.registerLanguage("css", css);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("handlebars", handlebars);
hljs.registerLanguage("twig", twig);

window.hljs = hljs;
