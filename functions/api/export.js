export async function onRequest(context) {
    const { request } = context;
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

    // id1/id2/name1/name2/dir finissent interpolés tels quels dans un script bash généré :
    // un caractère hors de cette whitelist permettrait d'en sortir (injection de commande).
    const SAFE_PATTERN = /^[a-zA-Z0-9_-]+$/;
    // dir admet aussi "/" pour les sous-dossiers, mais ni "." (pas de ../) ni "//" (segments vides).
    const DIR_SAFE_PATTERN = /^[a-zA-Z0-9_-]+(\/[a-zA-Z0-9_-]+)*$/;
    const badRequest = (msg) => new Response(msg, { status: 400 });

    if (!id1 || !SAFE_PATTERN.test(id1)) return badRequest("Paramètre id1 invalide (lettres, chiffres, _ et - uniquement).");
    if (id2 && !SAFE_PATTERN.test(id2)) return badRequest("Paramètre id2 invalide (lettres, chiffres, _ et - uniquement).");
    if (!SAFE_PATTERN.test(n1)) return badRequest("Paramètre name1 invalide (lettres, chiffres, _ et - uniquement).");
    if (!SAFE_PATTERN.test(n2)) return badRequest("Paramètre name2 invalide (lettres, chiffres, _ et - uniquement).");
    if (!DIR_SAFE_PATTERN.test(dir.replace(/^\/+|\/+$/g, ''))) return badRequest("Paramètre dir invalide (lettres, chiffres, _, - et / pour les sous-dossiers uniquement).");
    if (!['1', '2', '4'].includes(scale)) return badRequest("Paramètre scale invalide (valeurs autorisées : 1, 2, 4).");

    // 1. Chargement des données
    let templateReq = await fetch('https://raw.githubusercontent.com/Kenny3231/Pose-Explorer/main/public/templates_fr.json');
    if (!templateReq.ok) templateReq = await fetch('https://raw.githubusercontent.com/Kenny3231/Pose-Explorer/main/templates_fr.json');
    const rawData = await templateReq.json();

    const cleanName = (str) => {
        if (!str) return "pose";
        return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/'/g, " ").toLowerCase().replace(/[^a-z0-9 ]/g, "_").trim();
    };

    // --- PARTIE A : GÉNÉRATION DU JSON PRÉCIS ---
    if (type === 'json') {
        let metadata = [];
        const nameCount = {};

        // Cas 1 : Metadata pour un dossier SOLO (Utilisateur 1 ou 2)
        if (targetUser === '1' || targetUser === '2') {
            const currentName = targetUser === '1' ? n1 : n2;
            for (let t of rawData.imoji) {
                let tag = cleanName(t.displayTag);
                nameCount[tag] = (nameCount[tag] || 0) + 1;
                const suf = nameCount[tag] === 1 ? "" : `_${nameCount[tag]}`;
                const filename = `${currentName}__${tag}${suf}.png`;
                metadata.push({ 
                    fichier: filename, 
                    titre: t.displayTag, 
                    mots_cles: t.keywords || "", 
                    categories: t.categories || [] 
                });
            }
        } 
        // Cas 2 : Metadata pour le dossier DUO
        else if (targetUser === 'duo') {
            for (let t of rawData.friends) {
                let tag = cleanName(t.displayTag);
                nameCount[tag] = (nameCount[tag] || 0) + 1;
                const suf = nameCount[tag] === 1 ? "" : `_${nameCount[tag]}`;
                
                const f1 = `${n1}__${n2}__${tag}${suf}.png`;
                metadata.push({ fichier: f1, titre: t.displayTag, mots_cles: t.keywords || "", categories: t.categories || [] });
                const f2 = `${n2}__${n1}__${tag}${suf}.png`;
                metadata.push({ fichier: f2, titre: t.displayTag, mots_cles: t.keywords || "", categories: t.categories || [] });
            }
        }

        return new Response(JSON.stringify(metadata, null, 2), {
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
        });
    }

    // --- PARTIE B : GÉNÉRATION DU SCRIPT ---
    const targetDir = `/config/www/${dir.replace(/^\/+|\/+$/g, '')}`;
    let script = "#!/bin/bash\n\n";
    script += "echo '--- DEBUT DU TELECHARGEMENT ---'\n";
    
    const apiBase = `https://${url.hostname}/api/export?id1=${id1}&id2=${id2}&name1=${n1}&name2=${n2}&mode=${mode}&type=json`;

    // Fonction pour générer le téléchargement Solo (utilisée aussi en mode Duo)
    const buildSoloCmds = (id, name, userNum) => {
        let out = `echo 'Dossier Solo : ${name}'\n`;
        const counts = {};
        for (let t of rawData.imoji) {
            let tag = cleanName(t.displayTag);
            counts[tag] = (counts[tag] || 0) + 1;
            const suf = counts[tag] === 1 ? "" : `_${counts[tag]}`;
            const imgUrl = t.src.replace('%s', id) + `?transparent=1&palette=1&scale=${scale}`;
            out += `wget -q -U "Mozilla/5.0" -O "${targetDir}/${name}/${name}__${tag}${suf}.png" "${imgUrl}"\n`;
        }
        out += `wget -q -O "${targetDir}/${name}/metadata_${name}.json" "${apiBase}&targetUser=${userNum}"\n`;
        return out;
    };

    if (mode === 'solo') {
        script += buildSoloCmds(id1, n1, '1');
        if (id2) script += buildSoloCmds(id2, n2, '2');
    } else {
        // Mode DUO : on télécharge les 2 solos + les duos
        script += buildSoloCmds(id1, n1, '1');
        script += buildSoloCmds(id2, n2, '2');
        
        script += "echo 'Dossier Duo...'\n";
        const countsDuo = {};
        for (let t of rawData.friends) {
            let tag = cleanName(t.displayTag);
            countsDuo[tag] = (countsDuo[tag] || 0) + 1;
            const suf = countsDuo[tag] === 1 ? "" : `_${countsDuo[tag]}`;
            
            let u1 = t.src.replace('%s', id1).replace('%s', id2) + `?transparent=1&palette=1&scale=${scale}`;
            script += `wget -q -U "Mozilla/5.0" -O "${targetDir}/Duo/${n1}__${n2}__${tag}${suf}.png" "${u1}"\n`;
            
            let u2 = t.src.replace('%s', id2).replace('%s', id1) + `?transparent=1&palette=1&scale=${scale}`;
            script += `wget -q -U "Mozilla/5.0" -O "${targetDir}/Duo/${n2}__${n1}__${tag}${suf}.png" "${u2}"\n`;
        }
        script += `wget -q -O "${targetDir}/Duo/metadata_Duo.json" "${apiBase}&targetUser=duo"\n`;
    }

    script += "echo '--- TERMINE ---'\n";
    return new Response(script, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}