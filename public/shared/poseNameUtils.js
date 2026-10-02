// Logique de nettoyage de nom de pose, partagee entre le front (public/index.html,
// charge en <script type="module">) et l'API interne (functions/api/export.js, import ES).
// Modifier ce fichier suffit a mettre a jour les deux cotes a la fois.

export function cleanPoseName(value) {
    // Conversion defensive : un tag non-chaine (nombre, objet...) ne doit pas faire planter
    // .normalize(). Pour une chaine, le resultat est strictement inchange.
    const str = String(value ?? "");
    if (!str) return "pose";
    return str
        .normalize("NFD") // Separe les lettres de leurs accents
        .replace(/[\u0300-\u036f]/g, "") // Supprime les accents (e -> e)
        .replace(/'/g, " ") // Remplace les apostrophes par un espace
        .toLowerCase() // Met tout en minuscules
        .replace(/[^a-z0-9 ]/g, "_") // Remplace tout le reste (symboles bizarres) par des _
        .trim(); // Enleve les espaces en trop au debut et a la fin
}

// Pour les langues a alphabet non-latin (ja, ko, zh, el...), le tag natif peut se reduire
// a une chaine vide apres nettoyage : on retombe alors sur le tag anglais (slugFallback).
export function resolvePoseTag(title, slugFallback) {
    // cleanPoseName convertit deja ses entrees en chaine (String(x ?? "")).
    const tag = cleanPoseName(title);
    if (tag.replace(/[_ ]/g, "").length > 0) return tag;
    return cleanPoseName(slugFallback) || "pose";
}

// Nom de fichier de chaque pose d'une liste (tag nettoye + suffixe _2, _3... pour les doublons).
// La numerotation se fait sur la liste COMPLETE du catalogue, items invalides compris : un item
// ecarte ensuite (src refuse) ne decale donc pas les noms des suivants. Utilisee par l'API ET
// par le front (ZIP, metadata, lightbox) : un meme catalogue donne toujours les memes noms.
// Compteur en Map : un tag "__proto__" ou "constructor" reste un nom ordinaire.
export function poseFileTags(list) {
    const counts = new Map();
    return list.map((t) => {
        const tag = resolvePoseTag(t ? t.displayTag : undefined, t ? t.slugFallback : undefined);
        const n = (counts.get(tag) || 0) + 1;
        counts.set(tag, n);
        return n === 1 ? tag : `${tag}_${n}`;
    });
}
