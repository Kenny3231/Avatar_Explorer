import { poseFileTags } from '../../public/shared/poseNameUtils.js';

// Langues disponibles : un templates_<lang>.json doit exister (généré par public/get_templates.js).
// Pour ajouter une langue : générer son fichier templates_<lang>.json puis l'ajouter ici.
const SUPPORTED_LANGS = ['fr', 'en', 'es', 'fr-ca', 'de', 'ja', 'ko', 'it', 'pt', 'zh', 'tr', 'pl', 'ro', 'el'];

// id1/id2/name1/name2/dir finissent interpolés tels quels dans un script bash généré :
// un caractère hors de cette whitelist permettrait d'en sortir (injection de commande).
const SAFE_PATTERN = /^[a-zA-Z0-9_-]+$/;
// dir admet aussi "/" pour les sous-dossiers, mais ni "." (pas de ../) ni "//" (segments vides).
const DIR_SAFE_PATTERN = /^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/;

// t.src vient du catalogue Bitmoji (donnée EXTERNE, recopiée par get_templates.js) et finit
// entre guillemets doubles dans un script exécuté via `curl | bash`. On n'accepte donc que le CDN
// Bitmoji, avec un jeu de caractères qui ne permet pas de sortir des guillemets : ni ", ni $,
// ni backtick, ni \, ni espace. Même regex que SRC_PATTERN dans public/get_templates.js.
const SRC_PATTERN = /^https:\/\/sdk\.bitmoji\.com\/[A-Za-z0-9_\-\/.%]+$/;
// URL finale, après substitution des IDs et ajout de la query string (?, & et = en plus).
const IMG_URL_PATTERN = /^https:\/\/sdk\.bitmoji\.com\/[A-Za-z0-9_\-\/.%?&=]+$/;
// URL des metadata : cette même API, sur l'hôte qui a servi la requête.
const META_URL_PATTERN = /^https:\/\/[A-Za-z0-9.-]+\/api\/export\?[A-Za-z0-9_\-&=%]+$/;
// Défense en profondeur sur la destination : toujours sous /config/www/, sans "." hors extension
// (donc pas de ../) ni guillemet. Les espaces sont permis : cleanPoseName les conserve.
const DEST_PATTERN = /^\/config\/www\/[A-Za-z0-9_\-\/ ]+\.(?:png|json)$/;

// À incrémenter dès que le format de sortie change : invalide le cache caches.default
// (sinon une ancienne sortie pourrait être resservie jusqu'à une heure après un déploiement).
const OUTPUT_FORMAT_VERSION = '2';
// La sortie est déterministe pour un catalogue donné : on peut la cacher.
const CACHE_CONTROL = 'public, max-age=3600';

const textResponse = (msg, status, extraHeaders = {}) => new Response(msg, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders }
});
const badRequest = (msg) => textResponse(msg, 400);
const badGateway = (msg) => textResponse(msg, 502);

// Une réponse HEAD porte les mêmes en-têtes qu'un GET, sans corps.
const forMethod = (response, method) => method === 'HEAD'
    ? new Response(null, { status: response.status, headers: response.headers })
    : response;

// Le catalogue est un fichier statique servi par ce même site (déployé via public/get_templates.js).
// env.ASSETS le lit directement sans repasser par le réseau ; sinon on retombe sur un fetch HTTP.
// Toujours en GET, même si la requête entrante est un HEAD.
function fetchCatalog(context, url, lang) {
    const assetUrl = new URL(`/templates_${lang}.json`, url).toString();
    const assets = context.env && context.env.ASSETS;
    if (assets && typeof assets.fetch === 'function') {
        return assets.fetch(new Request(assetUrl, { method: 'GET' }));
    }
    return fetch(assetUrl);
}

// Clé de cache = URL demandée + version du catalogue (ETag de l'asset) + version du format :
// un nouveau catalogue ou un nouveau code donne une nouvelle clé, jamais une sortie périmée.
function buildCacheKey(url, catalogVersion) {
    const key = new URL(url.toString());
    key.searchParams.set('__v', `${OUTPUT_FORMAT_VERSION}-${catalogVersion}`);
    return new Request(key.toString(), { method: 'GET' });
}

function getDefaultCache() {
    try {
        return typeof caches !== 'undefined' && caches.default ? caches.default : null;
    } catch (e) {
        return null;
    }
}

export async function onRequest(context) {
    const { request } = context;
    const method = request.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
        return textResponse("Méthode non autorisée (GET ou HEAD uniquement).", 405, { 'Allow': 'GET, HEAD' });
    }

    const url = new URL(request.url);

    const id1 = url.searchParams.get('id1');
    const id2 = url.searchParams.get('id2');
    const n1 = url.searchParams.get('name1') || 'Utilisateur1';
    const n2 = url.searchParams.get('name2') || 'Utilisateur2';
    const mode = url.searchParams.get('mode') || 'solo';
    const scale = url.searchParams.get('scale') || '2';
    const dir = url.searchParams.get('dir') || 'bitmojis';
    const type = url.searchParams.get('type');
    const targetUser = url.searchParams.get('targetUser'); // '1', '2' ou 'duo'
    const lang = (url.searchParams.get('lang') || 'fr').toLowerCase();

    if (!id1 || !SAFE_PATTERN.test(id1)) return badRequest("Paramètre id1 invalide (lettres, chiffres, _ et - uniquement).");
    if (id2 && !SAFE_PATTERN.test(id2)) return badRequest("Paramètre id2 invalide (lettres, chiffres, _ et - uniquement).");
    if (!SAFE_PATTERN.test(n1)) return badRequest("Paramètre name1 invalide (lettres, chiffres, _ et - uniquement).");
    if (!SAFE_PATTERN.test(n2)) return badRequest("Paramètre name2 invalide (lettres, chiffres, _ et - uniquement).");
    if (!DIR_SAFE_PATTERN.test(dir.replace(/^\/+|\/+$/g, ''))) return badRequest("Paramètre dir invalide (lettres, chiffres, _, - et / pour les sous-dossiers uniquement).");
    if (!['1', '2', '4'].includes(scale)) return badRequest("Paramètre scale invalide (valeurs autorisées : 1, 2, 4).");
    if (!SUPPORTED_LANGS.includes(lang)) return badRequest(`Paramètre lang invalide. Langues supportées : ${SUPPORTED_LANGS.join(', ')}.`);
    if (!['solo', 'duo'].includes(mode)) return badRequest("Paramètre mode invalide (valeurs autorisées : solo, duo).");
    if (mode === 'duo' && !id2) return badRequest("Paramètre id2 requis pour le mode duo.");

    // 1. Chargement du catalogue. Toute panne ici (réseau, asset absent, JSON tronqué) est une
    // erreur côté serveur : on renvoie un 502 explicite plutôt que la page 1101 générique de Cloudflare.
    let templateRes;
    try {
        templateRes = await fetchCatalog(context, url, lang);
    } catch (e) {
        return badGateway("Catalogue injoignable, réessayez plus tard.");
    }
    if (!templateRes.ok) return badGateway(`Catalogue indisponible pour cette langue (HTTP ${templateRes.status}).`);

    // 2. Cache : parser 0,7 à 1,3 Mo de JSON à chaque appel coûte cher en CPU, alors que la sortie
    // ne dépend que des paramètres et du catalogue. Sans ETag, on ne cache pas (version inconnue).
    const cache = getDefaultCache();
    const catalogVersion = templateRes.headers.get('ETag');
    const cacheKey = cache && catalogVersion ? buildCacheKey(url, catalogVersion) : null;
    if (cacheKey) {
        try {
            const cached = await cache.match(cacheKey);
            if (cached) {
                if (templateRes.body) templateRes.body.cancel().catch(() => {});
                return forMethod(cached, method);
            }
        } catch (e) {
            // Cache indisponible : on génère normalement.
        }
    }

    let rawData;
    try {
        rawData = await templateRes.json();
    } catch (e) {
        return badGateway("Catalogue illisible (JSON invalide), réessayez plus tard.");
    }
    if (!rawData || !Array.isArray(rawData.imoji) || !Array.isArray(rawData.friends)) {
        return badGateway("Catalogue incomplet (listes imoji/friends absentes).");
    }

    const response = generate({ url, rawData, id1, id2, n1, n2, mode, scale, dir, lang, type, targetUser });

    if (cacheKey) {
        const put = cache.put(cacheKey, response.clone()).catch(() => {});
        if (typeof context.waitUntil === 'function') context.waitUntil(put);
    }
    return forMethod(response, method);
}

// Numérote les tags en doublon (_2, _3...) sur la liste COMPLÈTE, items invalides compris :
// ainsi un item rejeté ne décale pas les noms de fichiers des suivants. La numérotation vit
// dans poseFileTags (public/shared/poseNameUtils.js), partagée avec le front : le ZIP, ses
// metadata et la lightbox produisent exactement les mêmes noms que ce script.
function withFileTags(list) {
    const files = poseFileTags(list);
    return list.map((t, i) => {
        const validSrc = !!t && typeof t.src === 'string' && SRC_PATTERN.test(t.src);
        return { t, file: files[i], validSrc };
    });
}

function generate({ url, rawData, id1, id2, n1, n2, mode, scale, dir, lang, type, targetUser }) {
    const solo = withFileTags(rawData.imoji);
    const duo = withFileTags(rawData.friends);
    let skipped = 0;

    // --- PARTIE A : GÉNÉRATION DU JSON PRÉCIS ---
    if (type === 'json') {
        let metadata = [];
        const entry = (fichier, t) => ({ fichier, titre: t.displayTag, mots_cles: t.keywords || "", categories: t.categories || [] });

        // Cas 1 : Metadata pour un dossier SOLO (Utilisateur 1 ou 2)
        if (targetUser === '1' || targetUser === '2') {
            const currentName = targetUser === '1' ? n1 : n2;
            for (const { t, file, validSrc } of solo) {
                // Même filtre que le script : pas de metadata pour une image jamais téléchargée.
                if (!validSrc) { skipped++; continue; }
                metadata.push(entry(`${currentName}__${file}.png`, t));
            }
        }
        // Cas 2 : Metadata pour le dossier DUO
        else if (targetUser === 'duo') {
            for (const { t, file, validSrc } of duo) {
                if (!validSrc) { skipped += 2; continue; }
                metadata.push(entry(`${n1}__${n2}__${file}.png`, t));
                metadata.push(entry(`${n2}__${n1}__${file}.png`, t));
            }
        }

        return new Response(JSON.stringify(metadata, null, 2), {
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Cache-Control': CACHE_CONTROL,
                'X-Skipped-Items': String(skipped)
            }
        });
    }

    // --- PARTIE B : GÉNÉRATION DU SCRIPT ---
    // CONTRAT : l'intégration Home Assistant (catalog.py, WGET_LINE_RE) ne lit QUE les lignes
    //   wget -q [-U "<ua>"] -O "<dest>" "<url>"
    // Ne jamais changer leur forme (guillemets doubles, ordre -q / -U / -O). Les autres lignes
    // (commentaires, echo, set) sont ignorées par HA et peuvent évoluer librement.
    const targetDir = `/config/www/${dir.replace(/^\/+|\/+$/g, '')}`;
    let body = "";

    // Seul point d'écriture d'une ligne wget : dest et URL sont revalidées ici, en dernier rempart.
    const wget = (dest, fileUrl, withUserAgent) => {
        const urlOk = withUserAgent ? IMG_URL_PATTERN.test(fileUrl) : META_URL_PATTERN.test(fileUrl);
        if (!DEST_PATTERN.test(dest) || !urlOk) {
            skipped++;
            return "";
        }
        return withUserAgent
            ? `wget -q -U "Mozilla/5.0" -O "${dest}" "${fileUrl}"\n`
            : `wget -q -O "${dest}" "${fileUrl}"\n`;
    };

    // id2 n'est transmis que s'il existe (sinon l'URL contiendrait littéralement "id2=null").
    const apiParams = new URLSearchParams({ id1 });
    if (id2) apiParams.set('id2', id2);
    apiParams.set('name1', n1);
    apiParams.set('name2', n2);
    apiParams.set('mode', mode);
    apiParams.set('lang', lang);
    apiParams.set('type', 'json');
    const apiBase = `https://${url.hostname}/api/export?${apiParams.toString()}`;
    const imgQuery = `?transparent=1&palette=1&scale=${scale}`;

    // Fonction pour générer le téléchargement Solo (utilisée aussi en mode Duo)
    const buildSoloCmds = (id, name, userNum) => {
        let out = `echo 'Dossier Solo : ${name}'\n`;
        for (const { t, file, validSrc } of solo) {
            if (!validSrc) { skipped++; continue; }
            const imgUrl = t.src.replace('%s', id) + imgQuery;
            out += wget(`${targetDir}/${name}/${name}__${file}.png`, imgUrl, true);
        }
        out += wget(`${targetDir}/${name}/metadata_${name}.json`, `${apiBase}&targetUser=${userNum}`, false);
        return out;
    };

    if (mode === 'solo') {
        body += buildSoloCmds(id1, n1, '1');
        if (id2) body += buildSoloCmds(id2, n2, '2');
    } else {
        // Mode DUO : on télécharge les 2 solos + les duos
        body += buildSoloCmds(id1, n1, '1');
        body += buildSoloCmds(id2, n2, '2');

        body += "echo 'Dossier Duo...'\n";
        for (const { t, file, validSrc } of duo) {
            if (!validSrc) { skipped += 2; continue; }
            const u1 = t.src.replace('%s', id1).replace('%s', id2) + imgQuery;
            body += wget(`${targetDir}/Duo/${n1}__${n2}__${file}.png`, u1, true);

            const u2 = t.src.replace('%s', id2).replace('%s', id1) + imgQuery;
            body += wget(`${targetDir}/Duo/${n2}__${n1}__${file}.png`, u2, true);
        }
        body += wget(`${targetDir}/Duo/metadata_Duo.json`, `${apiBase}&targetUser=duo`, false);
    }

    // Pas de "set -e" : une pose absente chez Bitmoji (404) ferait échouer son wget et
    // interromprait tout le script, alors qu'elle doit simplement être ignorée.
    let script = "#!/bin/bash\n";
    script += "# Script généré par Avatar Explorer (/api/export). Les URLs sont validées côté serveur.\n";
    script += "set -uo pipefail\n\n";
    script += "echo '--- DEBUT DU TELECHARGEMENT ---'\n";
    if (skipped > 0) {
        script += `echo 'ATTENTION : ${skipped} fichier(s) ignoré(s) (URL ou destination invalide).'\n`;
    }
    script += body;
    script += "echo '--- TERMINE ---'\n";

    return new Response(script, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': CACHE_CONTROL,
            'X-Skipped-Items': String(skipped)
        }
    });
}
