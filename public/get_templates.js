const fs = require('fs');

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

async function fetchTemplates(languageHeader) {
    const response = await fetch("https://api.bitmoji.com/content/templates?app_name=bitmoji&platform=ios", {
        headers: { "Accept-Language": languageHeader }
    });

    if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);

    try {
        return await response.json();
    } catch (e) {
        throw new Error(`Réponse JSON invalide depuis l'API Bitmoji : ${e.message}`);
    }
}

// Reproduit exactement le nettoyage de nom de fichier utilisé côté front (formatPoseName)
// et côté API (cleanName), pour savoir si un tag donné donnerait un nom de fichier vide/inutile.
function isEmptySlug(str) {
    if (!str) return true;
    const cleaned = str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/'/g, " ")
        .toLowerCase().replace(/[^a-z0-9 ]/g, "_").trim();
    return cleaned.replace(/[_ ]/g, "").length === 0;
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

function writeTemplates(fileName, data, enTagById) {
    const imoji = processList(data.imoji || [], enTagById);
    const friends = processList(data.friends || [], enTagById);

    fs.writeFileSync(fileName, JSON.stringify({ categories: data.categories || [], imoji, friends }, null, 2));
    console.log(`✅ ${fileName} généré ! (Solo: ${imoji.length} | Duo: ${friends.length})`);

    return { solo: imoji.length, duo: friends.length };
}

async function fetchAndSaveTemplates(languageHeader, fileName, enTagById) {
    console.log(`📥 Récupération des données pour : ${fileName}...`);
    const data = await fetchTemplates(languageHeader);
    return writeTemplates(fileName, data, enTagById);
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

function updateAideJson(statsByLang) {
    const aidePath = 'aide.json';
    let aideData = {};

    // 1. On génère la date du jour en français (ex: "15 mars 2026") et en ISO 8601
    // pour les consommateurs API (ex: Avatar Explorer HA) qui veulent comparer une date.
    const now = new Date();
    const dateOptions = { day: 'numeric', month: 'long', year: 'numeric' };
    const dateMaj = now.toLocaleDateString('fr-FR', dateOptions);
    const lastUpdatedIso = now.toISOString();

    // 2. On lit le fichier existant pour ne pas écraser un guide déjà personnalisé !
    if (fs.existsSync(aidePath)) {
        try {
            aideData = JSON.parse(fs.readFileSync(aidePath, 'utf8'));
        } catch (e) {
            console.warn("⚠️ Fichier aide.json illisible, création d'un nouveau.");
        }
    }

    // 3. On met à jour les stats et la date
    aideData.date_maj = dateMaj;
    aideData.last_updated_iso = lastUpdatedIso;
    aideData.stats = statsByLang;

    // 4. guide devient un objet par langue. On complète les langues manquantes
    // avec le texte par défaut sans écraser un texte déjà personnalisé.
    if (!aideData.guide || typeof aideData.guide === 'string') {
        aideData.guide = { ...GUIDES };
    } else {
        aideData.guide = { ...GUIDES, ...aideData.guide };
    }

    // 5. On sauvegarde
    fs.writeFileSync(aidePath, JSON.stringify(aideData, null, 2));
    console.log(`📝 Fichier aide.json mis à jour avec succès ! (Date: ${dateMaj})`);
}

async function main() {
    console.log("🚀 Démarrage du script multilingue...");

    // On récupère l'anglais en premier : il sert de référence ASCII de secours
    // pour les langues à alphabet non-latin (voir isEmptySlug/buildEnTagMap).
    console.log("📥 Récupération des données pour : templates_en.json...");
    const enData = await fetchTemplates('en-US,en;q=0.9');
    const enTagById = buildEnTagMap(enData);

    const stats = { en: writeTemplates('templates_en.json', enData, null) };

    for (const { code, header } of LANGS) {
        if (code === 'en') continue;
        stats[code] = await fetchAndSaveTemplates(header, `templates_${code}.json`, enTagById);
    }

    // On met à jour le fichier d'aide
    updateAideJson(stats);

    console.log("🎉 Terminé ! Tout est à jour.");
}

main().catch(error => {
    console.error("❌ Échec du script :", error);
    process.exit(1);
});
