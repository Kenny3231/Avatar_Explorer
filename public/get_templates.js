const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');

// Usage (depuis public/) :
//   node get_templates.js            -> collecte, validation, écriture (CI)
//   node get_templates.js --dry-run  -> collecte et validation, sans rien écrire
//   node get_templates.js --check    -> valide uniquement les fichiers déjà sur disque (hors ligne)
const DRY_RUN = process.argv.includes('--dry-run');
const CHECK_ONLY = process.argv.includes('--check');

// Langue de référence (anglais) + les 13 langues traduites du catalogue.
// Pour ajouter une langue : ajouter une entrée ici avec son code et son header Accept-Language,
// puis l'ajouter aussi à SUPPORTED_LANGS dans functions/api/export.js et au sélecteur dans index.html.
const LANGS = [
    { code: 'en', header: 'en-US,en;q=0.9' },
    { code: 'fr', header: 'fr-FR,fr;q=0.9' },
    { code: 'es', header: 'es-ES,es;q=0.9' },
    { code: 'fr-ca', header: 'fr-CA,fr;q=0.9' },
    { code: 'de', header: 'de-DE,de;q=0.9' },
    { code: 'ja', header: 'ja-JP,ja;q=0.9' },
    { code: 'ko', header: 'ko-KR,ko;q=0.9' },
    { code: 'it', header: 'it-IT,it;q=0.9' },
    { code: 'pt', header: 'pt-PT,pt;q=0.9' },
    { code: 'zh', header: 'zh-CN,zh;q=0.9' },
    { code: 'tr', header: 'tr-TR,tr;q=0.9' },
    { code: 'pl', header: 'pl-PL,pl;q=0.9' },
    { code: 'ro', header: 'ro-RO,ro;q=0.9' },
    { code: 'el', header: 'el-GR,el;q=0.9' },
];

// Les src finissent entre guillemets doubles dans le script bash de /api/export (exécuté via
// `curl | bash`) : on n'accepte que le CDN Bitmoji et des caractères qui ne peuvent pas sortir
// des guillemets. Même regex que SRC_PATTERN dans functions/api/export.js.
const SRC_PATTERN = /^https:\/\/sdk\.bitmoji\.com\/[A-Za-z0-9_\-\/.%]+$/;
// Caractères refusés dans une catégorie : elles sont réinjectées dans le HTML du site.
const FORBIDDEN_CATEGORY_CHARS = /[<>"'`]/;
// Une liste qui perd plus de 20 % de ses poses d'un coup trahit une réponse amont tronquée
// ou dégradée : on refuse de la publier plutôt que d'écraser un catalogue sain.
const MAX_DROP_RATIO = 0.2;

const FETCH_TIMEOUT_MS = 30000;
const FETCH_ATTEMPTS = 3;
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function fetchTemplates(languageHeader) {
    let lastError;
    for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
        try {
            // Sans timeout, un amont qui ne répond plus figerait le job CI jusqu'à son délai maximal.
            const response = await fetch("https://api.bitmoji.com/content/templates?app_name=bitmoji&platform=ios", {
                headers: { "Accept-Language": languageHeader },
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
            });

            if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);

            try {
                return await response.json();
            } catch (e) {
                throw new Error(`Réponse JSON invalide depuis l'API Bitmoji : ${e.message}`);
            }
        } catch (e) {
            lastError = e;
            if (attempt < FETCH_ATTEMPTS) {
                // Backoff exponentiel : 2 s puis 4 s.
                const delay = 1000 * 2 ** attempt;
                console.warn(`⚠️ Tentative ${attempt}/${FETCH_ATTEMPTS} échouée (${languageHeader}) : ${e.message}. Nouvel essai dans ${delay / 1000} s...`);
                await sleep(delay);
            }
        }
    }
    throw new Error(`API Bitmoji injoignable après ${FETCH_ATTEMPTS} tentatives (${languageHeader}) : ${lastError.message}`);
}

// Nettoyage de nom de fichier partagé avec le front et l'API (public/shared/poseNameUtils.js,
// module ES) : chargé par import dynamique puisque ce script est en CommonJS.
let cleanPoseName = null;
async function loadPoseNameUtils() {
    const modulePath = path.join(__dirname, 'shared', 'poseNameUtils.js');
    ({ cleanPoseName } = await import(pathToFileURL(modulePath).href));
}

// Indique si un tag donnerait un nom de fichier vide/inutile une fois nettoyé.
// Le test "!str" est conservé : cleanPoseName renvoie "pose" pour une chaîne vide.
function isEmptySlug(str) {
    if (!str) return true;
    return cleanPoseName(str).replace(/[_ ]/g, "").length === 0;
}

// Map id -> tag anglais brut, utilisée comme repli pour les langues à alphabet non-latin
// (ja, ko, zh, el) dont le tag natif disparaîtrait entièrement après nettoyage du nom de fichier.
function buildEnTagMap(data) {
    const map = new Map();
    const addAll = (list) => {
        for (const item of list) {
            const cleanSrc = item.src ? item.src.split('?')[0] : "";
            const uniqueId = item.id || item.template_id || cleanSrc;
            const tag = item.tags && item.tags[0] ? item.tags[0] : "";
            if (uniqueId && tag) map.set(uniqueId, tag);
        }
    };
    addAll(data.imoji || []);
    addAll(data.friends || []);
    return map;
}

function processList(list, enTagById) {
    const seen = new Set();
    return list
        .map(item => {
            const cleanSrc = item.src ? item.src.split('?')[0] : "";
            const uniqueId = item.id || item.template_id || cleanSrc;
            const displayTag = item.tags && item.tags[0] ? item.tags[0] : "Pose";

            const searchData = [
                ...(item.tags || []),
                ...(item.supertags || []),
                item.alt_text || "",
                item.descriptive_alt_text || ""
            ].join(" ").toLowerCase();

            const entry = {
                id: uniqueId,
                src: cleanSrc,
                displayTag,
                keywords: searchData,
                categories: item.categories || []
            };

            if (enTagById && isEmptySlug(displayTag)) {
                const enTag = enTagById.get(uniqueId);
                if (enTag) entry.slugFallback = enTag;
            }

            return entry;
        })
        .filter(item => {
            if (!item.id || seen.has(item.id)) return false;
            seen.add(item.id);
            return true;
        });
}

// Construit le contenu d'un templates_<lang>.json en mémoire, sans l'écrire.
function buildTemplates(data, enTagById) {
    const imoji = processList(data.imoji || [], enTagById);
    const friends = processList(data.friends || [], enTagById);
    return { categories: data.categories || [], imoji, friends };
}

// Comparaison insensible aux fins de ligne : un checkout Windows (CRLF) ne doit pas
// passer pour un changement de contenu.
const hashContent = (text) => crypto.createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');

// Écriture atomique : fichier .tmp puis rename. Une coupure en cours d'écriture ne laisse
// jamais un JSON tronqué à la place d'un catalogue valide.
function writeFileAtomic(fileName, content) {
    const tmp = `${fileName}.tmp`;
    try {
        fs.writeFileSync(tmp, content);
        fs.renameSync(tmp, fileName);
    } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw e;
    }
}

function readJsonIfExists(fileName) {
    if (!fs.existsSync(fileName)) return null;
    try {
        return JSON.parse(fs.readFileSync(fileName, 'utf8'));
    } catch (e) {
        return null;
    }
}

// Textes du centre d'aide, un par langue supportée.
const GUIDES = {
    fr: "Bienvenue dans la Forge Bitmoji ! \n\n1. Entrez l'ID Bitmoji de l'utilisateur 1 (et 2 pour les duos).\n2. Utilisez les filtres pour trouver la pose parfaite.\n3. Cliquez sur une image pour la télécharger en HD, ou générez un ZIP contenant toutes les images filtrées.\n\n(D'autres aides seront ajoutées ici plus tard...)",
    en: "Welcome to the Bitmoji Forge! \n\n1. Enter the Bitmoji ID of user 1 (and 2 for duos).\n2. Use the filters to find the perfect pose.\n3. Click on an image to download it in HD, or generate a ZIP containing all filtered images.\n\n(More help will be added here later...)",
    es: "¡Bienvenido a la Forja Bitmoji! \n\n1. Introduce el ID de Bitmoji del usuario 1 (y el 2 para los duos).\n2. Usa los filtros para encontrar la pose perfecta.\n3. Haz clic en una imagen para descargarla en HD, o genera un ZIP con todas las imágenes filtradas.\n\n(Más ayuda se añadirá aquí más adelante...)",
    'fr-ca': "Bienvenue dans la Forge Bitmoji ! \n\n1. Entrez l'ID Bitmoji de l'utilisateur 1 (et 2 pour les duos).\n2. Utilisez les filtres pour trouver la pose parfaite.\n3. Cliquez sur une image pour la télécharger en HD, ou générez un ZIP contenant toutes les images filtrées.\n\n(D'autres trucs seront ajoutés ici plus tard...)",
    de: "Willkommen in der Bitmoji-Schmiede! \n\n1. Gib die Bitmoji-ID von Benutzer 1 ein (und 2 für Duos).\n2. Nutze die Filter, um die perfekte Pose zu finden.\n3. Klicke auf ein Bild, um es in HD herunterzuladen, oder erstelle ein ZIP mit allen gefilterten Bildern.\n\n(Weitere Hilfe wird später hier hinzugefügt...)",
    ja: "Bitmojiフォージへようこそ！\n\n1. ユーザー1のBitmoji IDを入力してください（デュオの場合はユーザー2も）。\n2. フィルターを使って理想のポーズを見つけましょう。\n3. 画像をクリックするとHDでダウンロードでき、フィルターしたすべての画像を含むZIPも生成できます。\n\n（今後さらにヘルプを追加予定です…）",
    ko: "Bitmoji 포지로 오신 것을 환영합니다! \n\n1. 사용자 1의 Bitmoji ID를 입력하세요 (듀오의 경우 2도 입력).\n2. 필터를 사용해 완벽한 포즈를 찾아보세요.\n3. 이미지를 클릭하면 HD로 다운로드할 수 있고, 필터링된 모든 이미지를 담은 ZIP도 생성할 수 있습니다.\n\n(추가 도움말은 나중에 추가될 예정입니다...)",
    it: "Benvenuto nella Forgia Bitmoji! \n\n1. Inserisci l'ID Bitmoji dell'utente 1 (e 2 per i duo).\n2. Usa i filtri per trovare la posa perfetta.\n3. Clicca su un'immagine per scaricarla in HD, oppure genera uno ZIP con tutte le immagini filtrate.\n\n(Altri aiuti verranno aggiunti qui in seguito...)",
    pt: "Bem-vindo à Forja Bitmoji! \n\n1. Digite o ID Bitmoji do usuário 1 (e o 2 para duplas).\n2. Use os filtros para encontrar a pose perfeita.\n3. Clique em uma imagem para baixá-la em HD, ou gere um ZIP com todas as imagens filtradas.\n\n(Mais ajuda será adicionada aqui futuramente...)",
    zh: "欢迎来到Bitmoji工坊！\n\n1. 输入用户1的Bitmoji ID（双人模式还需输入用户2）。\n2. 使用筛选器找到完美的姿势。\n3. 点击图片可下载高清版本，也可以生成包含所有筛选图片的ZIP压缩包。\n\n（更多帮助内容将在稍后添加……）",
    tr: "Bitmoji Dövme Atölyesine hoş geldiniz! \n\n1. Kullanıcı 1'in Bitmoji kimliğini girin (ikili modlar için 2'yi de girin).\n2. Mükemmel pozu bulmak için filtreleri kullanın.\n3. Bir görsele tıklayarak HD kalitesinde indirin veya filtrelenmiş tüm görselleri içeren bir ZIP oluşturun.\n\n(Daha fazla yardım daha sonra buraya eklenecektir...)",
    pl: "Witamy w Kuźni Bitmoji! \n\n1. Wpisz ID Bitmoji użytkownika 1 (i 2 dla trybu duo).\n2. Skorzystaj z filtrów, aby znaleźć idealną pozę.\n3. Kliknij obraz, aby pobrać go w HD, lub wygeneruj plik ZIP zawierający wszystkie przefiltrowane obrazy.\n\n(Więcej pomocy zostanie dodane tutaj później...)",
    ro: "Bine ai venit în Forja Bitmoji! \n\n1. Introdu ID-ul Bitmoji al utilizatorului 1 (și 2 pentru duo-uri).\n2. Folosește filtrele pentru a găsi poza perfectă.\n3. Dă clic pe o imagine pentru a o descărca în HD, sau generează o arhivă ZIP cu toate imaginile filtrate.\n\n(Mai mult ajutor va fi adăugat aici ulterior...)",
    el: "Καλώς ήρθατε στο Bitmoji Forge! \n\n1. Εισαγάγετε το ID Bitmoji του χρήστη 1 (και του 2 για δυάδες).\n2. Χρησιμοποιήστε τα φίλτρα για να βρείτε την τέλεια πόζα.\n3. Κάντε κλικ σε μια εικόνα για να την κατεβάσετε σε HD, ή δημιουργήστε ένα ZIP με όλες τις φιλτραρισμένες εικόνες.\n\n(Περισσότερη βοήθεια θα προστεθεί εδώ αργότερα...)",
};

// Construit le contenu d'aide.json. Les dates ne bougent QUE si un catalogue a réellement
// changé : les consommateurs (ex: Avatar Explorer HA) relancent une synchro dès que
// last_updated_iso avance, il ne doit donc pas avancer pour rien.
function buildAideJson(statsByLang, catalogChanged) {
    const aidePath = 'aide.json';
    let aideData = {};

    // 1. On lit le fichier existant pour ne pas écraser un guide déjà personnalisé !
    if (fs.existsSync(aidePath)) {
        try {
            aideData = JSON.parse(fs.readFileSync(aidePath, 'utf8'));
        } catch (e) {
            console.warn("⚠️ Fichier aide.json illisible, création d'un nouveau.");
        }
    }

    // 2. Date du jour en français (ex: "15 mars 2026") et en ISO 8601 pour les consommateurs
    // API qui veulent comparer une date. Seulement si le catalogue a changé (ou date absente).
    if (catalogChanged || !aideData.last_updated_iso) {
        const now = new Date();
        const dateOptions = { day: 'numeric', month: 'long', year: 'numeric' };
        aideData.date_maj = now.toLocaleDateString('fr-FR', dateOptions);
        aideData.last_updated_iso = now.toISOString();
    }

    // 3. On met à jour les stats
    aideData.stats = statsByLang;

    // 4. guide devient un objet par langue. On complète les langues manquantes
    // avec le texte par défaut sans écraser un texte déjà personnalisé.
    if (!aideData.guide || typeof aideData.guide === 'string') {
        aideData.guide = { ...GUIDES };
    } else {
        aideData.guide = { ...GUIDES, ...aideData.guide };
    }

    return aideData;
}

// Langues a alphabet non-latin : leur tag natif peut disparaitre completement
// apres nettoyage du nom de fichier (voir isEmptySlug), d'ou l'exigence d'un slugFallback.
const NON_LATIN_LANGS = ['ja', 'ko', 'zh', 'el'];

// Recense toutes les chaînes d'une catégorie (une chaîne, ou un objet renvoyé par l'API).
function collectStrings(value, out = []) {
    if (typeof value === 'string') out.push(value);
    else if (Array.isArray(value)) value.forEach(v => collectStrings(v, out));
    else if (value && typeof value === 'object') Object.values(value).forEach(v => collectStrings(v, out));
    return out;
}

// Validation d'un catalogue EN MÉMOIRE, avant toute écriture. `previous` est la version
// actuellement sur disque (ou null) et sert au contrôle anti-régression de volume.
function validateTemplates(fileName, code, data, previous) {
    const errors = [];
    const warnings = [];

    if (JSON.stringify(data).includes('�')) {
        errors.push(`${fileName} contient des caractères de remplacement U+FFFD (corruption d'encodage).`);
    }

    for (const listName of ['imoji', 'friends']) {
        const list = data[listName];
        if (!Array.isArray(list) || list.length === 0) {
            errors.push(`${fileName} : liste "${listName}" vide ou absente.`);
            continue;
        }

        const prevList = previous && Array.isArray(previous[listName]) ? previous[listName] : null;
        if (prevList && prevList.length > 0 && list.length < prevList.length * (1 - MAX_DROP_RATIO)) {
            errors.push(`${fileName} : liste "${listName}" passe de ${prevList.length} à ${list.length} entrées (chute > ${MAX_DROP_RATIO * 100} %), refusé.`);
        }

        for (const item of list) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) {
                errors.push(`${fileName} : liste "${listName}" contient un item qui n'est pas un objet (${JSON.stringify(item)}).`);
                continue;
            }
            // displayTag et slugFallback donnent le nom des fichiers (front, ZIP, API) : on exige
            // des chaînes plutôt que de laisser une conversion implicite produire un nom inattendu.
            if (typeof item.displayTag !== 'string') {
                errors.push(`${fileName} : item id=${item.id} a un displayTag qui n'est pas une chaîne (${JSON.stringify(item.displayTag)}).`);
            }
            if (item.slugFallback !== undefined && typeof item.slugFallback !== 'string') {
                errors.push(`${fileName} : item id=${item.id} a un slugFallback qui n'est pas une chaîne (${JSON.stringify(item.slugFallback)}).`);
            }
            if (typeof item.src !== 'string' || !SRC_PATTERN.test(item.src)) {
                errors.push(`${fileName} : item id=${item.id} a un src invalide (${JSON.stringify(item.src)}).`);
            }
            for (const cat of collectStrings(item.categories || [])) {
                if (FORBIDDEN_CATEGORY_CHARS.test(cat)) {
                    errors.push(`${fileName} : item id=${item.id} a une catégorie avec un caractère interdit (${JSON.stringify(cat)}).`);
                }
            }
        }
    }

    for (const cat of collectStrings(data.categories || [])) {
        if (FORBIDDEN_CATEGORY_CHARS.test(cat)) {
            errors.push(`${fileName} : catégorie globale avec un caractère interdit (${JSON.stringify(cat)}).`);
        }
    }

    if (NON_LATIN_LANGS.includes(code)) {
        // Pas bloquant : ces items n'ont simplement pas d'équivalent dans le catalogue
        // anglais (ID absent du catalogue de référence). Le nommage de fichier retombe
        // alors sur le mot générique "pose" (voir cleanPoseName), sans casser le script.
        for (const item of [...(data.imoji || []), ...(data.friends || [])]) {
            if (item && isEmptySlug(item.displayTag) && !item.slugFallback) {
                warnings.push(`${fileName} : item id=${item.id} n'a pas d'équivalent anglais (nom de fichier générique "pose" en repli).`);
            }
        }
    }

    return { errors, warnings };
}

function reportValidation(label, errors, warnings, count) {
    if (warnings.length > 0) {
        console.warn(`⚠️ ${label} : ${warnings.length} avertissement(s) non bloquant(s) :\n- ${warnings.join('\n- ')}`);
    }
    if (errors.length > 0) {
        throw new Error(`${label} échouée :\n- ${errors.join('\n- ')}`);
    }
    console.log(`✅ ${label} OK (${count} langues, ${warnings.length} avertissement(s)).`);
}

// Filet de securite avant de laisser la CI committer : relit les fichiers sur disque. Une
// regression ici (fichier manquant, encodage corrompu, src hors CDN Bitmoji, slugFallback
// manquant) ferait planter le script au lieu de pousser des données cassées sur origin/main.
function verifyOutputs(allCodes) {
    const errors = [];
    const warnings = [];

    for (const code of allCodes) {
        const fileName = `templates_${code}.json`;
        if (!fs.existsSync(fileName)) {
            errors.push(`${fileName} est manquant.`);
            continue;
        }

        const raw = fs.readFileSync(fileName, 'utf8');
        let data;
        try {
            data = JSON.parse(raw);
        } catch (e) {
            errors.push(`${fileName} n'est pas un JSON valide : ${e.message}`);
            continue;
        }

        const result = validateTemplates(fileName, code, data, null);
        errors.push(...result.errors);
        warnings.push(...result.warnings);
    }

    if (!fs.existsSync('aide.json')) {
        errors.push('aide.json est manquant.');
    } else {
        let aide;
        try {
            aide = JSON.parse(fs.readFileSync('aide.json', 'utf8'));
        } catch (e) {
            errors.push(`aide.json n'est pas un JSON valide : ${e.message}`);
            aide = null;
        }
        if (aide) {
            if (!aide.last_updated_iso || Number.isNaN(Date.parse(aide.last_updated_iso))) errors.push('aide.json : last_updated_iso absent ou invalide.');
            for (const code of allCodes) {
                if (!aide.stats || !aide.stats[code]) errors.push(`aide.json : stats.${code} manquant.`);
                if (!aide.guide || !aide.guide[code]) errors.push(`aide.json : guide.${code} manquant.`);
            }
        }
    }

    reportValidation('Vérification post-génération', errors, warnings, allCodes.length);
}

async function main() {
    await loadPoseNameUtils();
    const allCodes = LANGS.map(l => l.code);

    if (CHECK_ONLY) {
        console.log("🔎 Vérification des fichiers existants (aucun appel réseau)...");
        verifyOutputs(allCodes);
        return;
    }

    console.log(`🚀 Démarrage du script multilingue...${DRY_RUN ? ' (mode --dry-run : aucune écriture)' : ''}`);

    // 1. Collecte de TOUTES les langues en mémoire. L'anglais d'abord : il sert de référence
    // ASCII de secours pour les langues à alphabet non-latin (voir isEmptySlug/buildEnTagMap).
    console.log("📥 Récupération des données pour : templates_en.json...");
    const enData = await fetchTemplates('en-US,en;q=0.9');
    const enTagById = buildEnTagMap(enData);

    const built = { en: buildTemplates(enData, null) };
    for (const { code, header } of LANGS) {
        if (code === 'en') continue;
        console.log(`📥 Récupération des données pour : templates_${code}.json...`);
        built[code] = buildTemplates(await fetchTemplates(header), enTagById);
    }

    // 2. Validation AVANT écriture, comparée à la version actuellement sur disque :
    // si une seule langue est invalide, rien n'est écrit.
    const errors = [];
    const warnings = [];
    const pending = [];
    const stats = {};
    for (const code of allCodes) {
        const fileName = `templates_${code}.json`;
        const data = built[code];
        const result = validateTemplates(fileName, code, data, readJsonIfExists(fileName));
        errors.push(...result.errors);
        warnings.push(...result.warnings);

        const content = JSON.stringify(data, null, 2);
        const previousHash = fs.existsSync(fileName) ? hashContent(fs.readFileSync(fileName, 'utf8')) : null;
        const changed = previousHash !== hashContent(content);
        pending.push({ fileName, content, changed });
        stats[code] = { solo: data.imoji.length, duo: data.friends.length };
        console.log(`${changed ? '🆕' : '➖'} ${fileName} ${changed ? 'modifié' : 'inchangé'} (Solo: ${data.imoji.length} | Duo: ${data.friends.length})`);
    }
    reportValidation('Validation pré-écriture', errors, warnings, allCodes.length);

    const catalogChanged = pending.some(p => p.changed);
    const aideContent = JSON.stringify(buildAideJson(stats, catalogChanged), null, 2);

    if (DRY_RUN) {
        console.log(`🧪 --dry-run : ${pending.filter(p => p.changed).length} catalogue(s) seraient réécrits, last_updated_iso ${catalogChanged ? 'serait mis à jour' : 'resterait inchangé'}. Aucun fichier écrit.`);
        return;
    }

    // 3. Écriture atomique, uniquement de ce qui a changé.
    for (const { fileName, content, changed } of pending) {
        if (changed) writeFileAtomic(fileName, content);
    }
    const aideChanged = !fs.existsSync('aide.json') || hashContent(fs.readFileSync('aide.json', 'utf8')) !== hashContent(aideContent);
    if (aideChanged) {
        writeFileAtomic('aide.json', aideContent);
        console.log(`📝 Fichier aide.json mis à jour${catalogChanged ? ' (nouvelle date de mise à jour)' : ' (date inchangée : catalogue identique)'}.`);
    } else {
        console.log("➖ aide.json inchangé.");
    }

    verifyOutputs(allCodes);

    console.log(catalogChanged ? "🎉 Terminé ! Catalogue mis à jour." : "🎉 Terminé ! Catalogue déjà à jour, rien à publier.");
}

main().catch(error => {
    console.error("❌ Échec du script :", error);
    process.exit(1);
});
