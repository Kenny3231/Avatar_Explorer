🇫🇷 Français | 🇬🇧 [English](README.en.md)

# 🎨 Avatar Explorer

Une application web interactive et rapide permettant de rechercher, filtrer et télécharger des poses Bitmoji (Solo et Duo) en haute définition. 

## ✨ Fonctionnalités

* **Recherche Avancée :** Filtrage intelligent des poses ignorant les accents et les majuscules.
* **Interface & Catalogue en 14 langues :** Français, Anglais, Espagnol, Français (Canada), Allemand, Japonais, Coréen, Italien, Portugais, Chinois, Turc, Polonais, Roumain, Grec. Le sélecteur de langue traduit **toute l'interface** (textes, boutons, centre d'aide) en plus du catalogue de poses.
* **Catégories Dynamiques :** Menu déroulant autocomplété listant toutes les catégories existantes.
* **Modes Solo & Duo :** Aperçu avec un ou deux personnages simultanément.
* **Export Massif :** Génération d'un fichier `.zip` depuis l'interface web (limité par le navigateur).
* **🤖 Export Automatique (Recommandé) :** Génération d'un script Bash pour une intégration directe et illimitée dans Home Assistant.

---

## 🤖 Intégration Home Assistant (Automatique)

Cette fonctionnalité permet de télécharger automatiquement l'intégralité des poses et les fichiers de métadonnées directement dans votre stockage Home Assistant sans intervention manuelle.

### Commande rapide
Exécutez cette commande dans votre terminal Home Assistant (Add-on "Terminal & SSH") :

```bash
curl -sL "https://avatar-explorer.pages.dev/api/export?id1=VOTRE_ID&name1=Kenny&mode=solo&dir=bitmojis" | bash
```

### Paramètres de l'API
| Paramètre | Description | Valeurs possibles |
| :--- | :--- | :--- |
| `id1` | **(Requis)** ID Bitmoji principal | Ex: `103719...` |
| `id2` | ID Bitmoji ami (requis pour duo) | Ex: `284610...` |
| `name1` | Dossier/Préfixe utilisateur 1 | Défaut: `Utilisateur1` |
| `name2` | Dossier/Préfixe utilisateur 2 | Défaut: `Utilisateur2` |
| `mode` | Type de poses à récupérer | `solo` ou `duo` |
| `scale` | Qualité de l'image (1x, 2x, 4x) | `1`, `2`, `4` |
| `dir` | Dossier dans `/config/www/` (sous-dossiers possibles avec `/`) | Défaut: `bitmojis`, ex: `media/bitmojis` |
| `lang` | Langue du catalogue de poses | Défaut: `fr`. Voir [langues disponibles](#-langues-disponibles) |

### 🌐 Langues disponibles

| Code | Langue |
| :--- | :--- |
| `fr` | Français (défaut) |
| `en` | Anglais |
| `es` | Espagnol |
| `fr-ca` | Français (Canada) |
| `de` | Allemand |
| `ja` | Japonais |
| `ko` | Coréen |
| `it` | Italien |
| `pt` | Portugais |
| `zh` | Chinois |
| `tr` | Turc |
| `pl` | Polonais |
| `ro` | Roumain |
| `el` | Grec |

> [!NOTE]
> Cette liste peut s'étendre avec le temps (cf. `SUPPORTED_LANGS` dans [functions/api/export.js](functions/api/export.js)). Chaque langue suppose l'existence d'un fichier `public/templates_<lang>.json`, généré par [public/get_templates.js](public/get_templates.js). Pour les langues à alphabet non-latin (`ja`, `ko`, `zh`, `el`), un champ `slugFallback` (tag anglais correspondant) garantit que les noms de fichiers générés restent lisibles même quand le tag natif ne contient aucun caractère latin.

> [!IMPORTANT]
> **Pré-requis :** Avant de lancer la commande, assurez-vous de créer manuellement vos dossiers de destination dans `/config/www/` (ex: `/config/www/bitmojis/Kenny/`). Le script nécessite que les dossiers existent pour y déposer les fichiers `.png` et `.json`.

---

## 📡 API de métadonnées (`aide.json`)

Le fichier `aide.json` est servi statiquement à la racine du site et expose entre autres la date du dernier import du catalogue. Utile pour qu'une application tierce (ex: Avatar Explorer HA) sache si elle doit relancer un import.

### Endpoint
```
GET https://avatar-explorer.pages.dev/aide.json
```

### Réponse
```json
{
  "date_maj": "19 juillet 2026",
  "last_updated_iso": "2026-07-19T10:10:28.730Z",
  "stats": {
    "fr": { "solo": 1261, "duo": 614 },
    "en": { "solo": 1975, "duo": 1050 },
    "es": { "solo": 1278, "duo": 607 },
    "...": { "solo": "...", "duo": "..." }
  },
  "guide": {
    "fr": "Bienvenue dans la Forge Bitmoji ! ...",
    "en": "Welcome to the Bitmoji Forge! ...",
    "es": "¡Bienvenido a la Forja Bitmoji! ...",
    "...": "..."
  }
}
```

| Champ | Type | Description |
| :--- | :--- | :--- |
| `date_maj` | `string` | Date du dernier import, formatée en français (affichage uniquement, ne pas parser). |
| `last_updated_iso` | `string` (ISO 8601) | Date du dernier import, à utiliser pour toute comparaison programmatique. |
| `stats.<lang>` | `{ solo: number, duo: number }` | Nombre de poses disponibles pour la langue `<lang>` (un des 14 codes ci-dessus), par mode. |
| `guide.<lang>` | `string` (Markdown) | Texte affiché dans le centre d'aide de l'application, traduit pour la langue `<lang>`. |

### Exemple d'utilisation
```js
const { last_updated_iso } = await fetch('https://avatar-explorer.pages.dev/aide.json').then(r => r.json());
const remoteDate = new Date(last_updated_iso);

if (remoteDate > localLastImportDate) {
  // déclencher un nouvel import
}
```

> [!NOTE]
> `aide.json` est régénéré automatiquement chaque lundi (cron GitHub Actions) et à chaque déclenchement manuel du workflow `update_data.yml`. `last_updated_iso` ne change que si cet import a réellement eu lieu.

---

## 🛠️ Technologies Utilisées

* **Frontend :** HTML5, JavaScript (Vanilla), TailwindCSS (CDN), Lucide Icons.
* **Backend (Cloudflare Workers) :** API d'exportation dynamique pour la génération de scripts Bash et de métadonnées JSON.
* **Bibliothèques JS :** JSZip, FileSaver.js.

## 🚀 Installation & Utilisation locale

1.  **Cloner le dépôt :**
    ```bash
    git clone https://github.com/Kenny3231/Avatar_Explorer.git
    cd Avatar_Explorer
    ```
2.  **Lancer le projet :**
    Ouvrez simplement le fichier `index.html` dans votre navigateur.

## ⚠️ Disclaimer (Avertissement légal)

* Ce projet est une application non-officielle développée à des fins personnelles et éducatives uniquement.
* **Propriété intellectuelle :** Le nom "Bitmoji" ainsi que tous les visuels, avatars et logos associés sont la propriété exclusive de **Snap Inc. (Snapchat)**. Cette application n'est ni affiliée, ni approuvée, ni sponsorisée par Snap Inc.
* **Utilisation des ressources :** Cette interface utilise les points d'accès publics de l'API Bitmoji. L'utilisateur est responsable de l'usage qu'il fait des images générées.
* **Absence de garantie :** Le logiciel est fourni "tel quel", sans garantie d'aucune sorte. En aucun cas, l'auteur ne pourra être tenu responsable des dommages résultant de l'utilisation de ce logiciel.
