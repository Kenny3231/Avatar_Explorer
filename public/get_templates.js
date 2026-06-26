const fs = require('fs');

async function fetchAndSaveTemplates(languageHeader, fileName) {
    console.log(`📥 Récupération des données pour : ${fileName}...`);

    const response = await fetch("https://api.bitmoji.com/content/templates?app_name=bitmoji&platform=ios", {
        headers: { "Accept-Language": languageHeader }
    });

    if (!response.ok) throw new Error(`Erreur HTTP: ${response.status}`);

    let data;
    try {
        data = await response.json();
    } catch (e) {
        throw new Error(`Réponse JSON invalide depuis l'API Bitmoji : ${e.message}`);
    }

    const processList = (list) => {
        const seen = new Set();
        return list
            .map(item => {
                const cleanSrc = item.src ? item.src.split('?')[0] : "";
                const uniqueId = item.id || item.template_id || cleanSrc;

                const searchData = [
                    ...(item.tags || []),
                    ...(item.supertags || []),
                    item.alt_text || "",
                    item.descriptive_alt_text || ""
                ].join(" ").toLowerCase();

                return {
                    id: uniqueId,
                    src: cleanSrc,
                    displayTag: item.tags && item.tags[0] ? item.tags[0] : "Pose",
                    keywords: searchData,
                    categories: item.categories || []
                };
            })
            .filter(item => {
                if (!item.id || seen.has(item.id)) return false;
                seen.add(item.id);
                return true;
            });
    };

    const imoji = processList(data.imoji || []);
    const friends = processList(data.friends || []);

    const cleanData = {
        categories: data.categories || [],
        imoji: imoji,
        friends: friends
    };

    fs.writeFileSync(fileName, JSON.stringify(cleanData, null, 2));
    console.log(`✅ ${fileName} généré ! (Solo: ${imoji.length} | Duo: ${friends.length})`);

    // On retourne les statistiques pour les utiliser dans aide.json
    return { solo: imoji.length, duo: friends.length };
}

// Nouvelle fonction pour générer ou mettre à jour aide.json
function updateAideJson(statsFr, statsEn) {
    const aidePath = 'aide.json';
    let aideData = {};

    // 1. On génère la date du jour en français (ex: "15 mars 2026")
    const dateOptions = { day: 'numeric', month: 'long', year: 'numeric' };
    const dateMaj = new Date().toLocaleDateString('fr-FR', dateOptions);

    // 2. On lit le fichier existant pour ne pas écraser ton texte de guide !
    if (fs.existsSync(aidePath)) {
        try {
            aideData = JSON.parse(fs.readFileSync(aidePath, 'utf8'));
        } catch (e) {
            console.warn("⚠️ Fichier aide.json illisible, création d'un nouveau.");
        }
    }

    // 3. On met à jour uniquement les stats et la date
    aideData.date_maj = dateMaj;
    aideData.stats = {
        fr: statsFr,
        en: statsEn
    };
    
    // Si le guide n'existe pas encore, on met un texte par défaut
    if (!aideData.guide) {
        aideData.guide = "Bienvenue dans la Forge Bitmoji ! \n\n1. Entrez l'ID Bitmoji de l'utilisateur 1 (et 2 pour les duos).\n2. Utilisez les filtres pour trouver la pose parfaite.\n3. Cliquez sur une image pour la télécharger en HD, ou générez un ZIP contenant toutes les images filtrées.\n\n(D'autres aides seront ajoutées ici plus tard...)";
    }

    // 4. On sauvegarde
    fs.writeFileSync(aidePath, JSON.stringify(aideData, null, 2));
    console.log(`📝 Fichier aide.json mis à jour avec succès ! (Date: ${dateMaj})`);
}

async function main() {
    console.log("🚀 Démarrage du script bilingue...");
    
    // On récupère les stats de chaque langue
    const statsFr = await fetchAndSaveTemplates("fr-FR,fr;q=0.9", "templates_fr.json");
    const statsEn = await fetchAndSaveTemplates("en-US,en;q=0.9", "templates_en.json");
    
    // On met à jour le fichier d'aide
    updateAideJson(statsFr, statsEn);
    
    console.log("🎉 Terminé ! Tout est à jour.");
}

main().catch(error => {
    console.error("❌ Échec du script :", error);
    process.exit(1);
});