// Logique de nettoyage de nom de pose, partagee entre le front (public/index.html,
// charge en <script type="module">) et l'API interne (functions/api/export.js, import ES).
// Modifier ce fichier suffit a mettre a jour les deux cotes a la fois.

export function cleanPoseName(str) {
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
    const tag = cleanPoseName(title);
    if (tag.replace(/[_ ]/g, "").length > 0) return tag;
    return cleanPoseName(slugFallback) || "pose";
}
