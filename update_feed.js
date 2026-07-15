const fs = require('fs');
const fetch = require('node-fetch');

// URLs des sources
const POSTS_URL = "https://raw.githubusercontent.com/cyberiskvision/dls-monitor/main/posts.json";
const RANSOM_LIVE_RAW = "https://raw.githubusercontent.com/Casualtek/Ransomware.live/main/posts.json";
const RANSOMLIVE_API_FR = "https://api.ransomware.live/v2/countryvictims/FR";
const RANSOMLOOK_API = "https://www.ransomlook.io/api/posts?days=3";

// Un User-Agent générique évite les blocages 403 de certaines API publiques
const FETCH_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CyberMonitorFR/1.0)' } };

// Fenêtre de fraîcheur : on ne garde QUE ce qui a été publié il y a moins de 72h.
// Au-delà de ce filtre, aucune limite sur le nombre d'alertes affichées.
const MAX_AGE_HOURS = 72;

function sanitizeText(text) {
    if (!text) return "";
    return text
        .replace(/[\w\.-]+@[\w\.-]+\.\w+/g, '[EMAIL_PROTECTED]')
        .replace(/\+?\d{10,13}/g, '[PHONE_PROTECTED]')
        .trim();
}

function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

// Formulations volontairement percutantes/choquantes mais toujours au conditionnel
// ("revendique", "affirme", "menace") car il s'agit d'accusations non vérifiées
// émises par les groupes eux-mêmes sur leur site de fuite.
const GENERIC_TEMPLATES = [
    (t, g) => `🚨 ${g} revendique une intrusion chez ${t} et menace de publier l'intégralité des données volées si la rançon n'est pas payée.`,
    (t, g) => `${t} dans le viseur de ${g} : les cybercriminels affirment détenir des données sensibles et menacent de tout diffuser sur le dark web.`,
    (t, g) => `Chantage numérique en cours : ${g} affirme avoir infiltré ${t} et donne un ultimatum avant publication des fichiers.`,
    (t, g) => `${g} frappe ${t} : vol de données revendiqué, fuite imminente sur le dark web si aucune rançon n'est versée.`,
    (t, g) => `Nouvelle victime pour ${g} : ${t} accusée d'avoir été totalement compromise, données confidentielles prises en otage.`
];

const FRANCE_TEMPLATES = [
    (t, g, s) => `🇫🇷 ${t}${s} visée en France : ${g} revendique l'intrusion et menace de divulguer les données volées.`,
    (t, g, s) => `🇫🇷 Alerte France : ${g} affirme avoir compromis ${t}${s}, et exige une rançon sous peine de fuite massive.`,
    (t, g, s) => `🇫🇷 ${g} s'en prend à une cible française : ${t}${s} accusée d'avoir eu ses données volées et menacée de publication.`,
    (t, g, s) => `🇫🇷 Chantage numérique sur le sol français : ${t}${s} au cœur d'une revendication de ${g}.`
];

function buildRecap(target, group, secteur, isFrance) {
    if (isFrance) {
        const secteurTxt = secteur ? ` (secteur ${secteur})` : "";
        return sanitizeText(pick(FRANCE_TEMPLATES)(target, group, secteurTxt));
    }
    return sanitizeText(pick(GENERIC_TEMPLATES)(target, group));
}

// Renvoie true si la date (string ISO ou parsable) est dans la fenêtre MAX_AGE_HOURS
function isRecent(dateStr) {
    if (!dateStr) return false;
    const t = Date.parse(dateStr);
    if (isNaN(t)) return false;
    const ageHours = (Date.now() - t) / 3600000;
    return ageHours >= 0 && ageHours <= MAX_AGE_HOURS;
}

async function getCyberFeed() {
    console.log(`--- DEBUT DE L'EXTRACTION MULTI-SOURCES NODE.JS (FENÊTRE ${MAX_AGE_HOURS}H) ---`);
    let outputFeed = [];

    // ==========================================
    // CUMUL - ETAPE 1 : SOURCE 1 (Cyberisk)
    // ==========================================
    console.log(`Connexion Source 1 : ${POSTS_URL}`);
    try {
        const response = await fetch(POSTS_URL, FETCH_HEADERS);
        if (response.status === 200) {
            let posts = await response.json();
            posts.sort((a, b) => (b.discovered || "").localeCompare(a.discovered || ""));

            let countSource1 = 0;
            for (const post of posts) {
                const dateRaw = post.discovered || "";
                if (!isRecent(dateRaw)) continue;

                const title = post.post_title || "Cible Inconnue";
                const group = (post.group_name || "unknown").toUpperCase();

                outputFeed.push({
                    target: sanitizeText(title),
                    hacker: group,
                    time: dateRaw,
                    details: buildRecap(sanitizeText(title), group, "", false)
                });
                countSource1++;
            }
            console.log(`OK: ${countSource1} éléments (< ${MAX_AGE_HOURS}h) chargés depuis Source 1.`);
        }
    } catch (e) {
        console.log(`Note: Échec Source 1 -> ${e.message}`);
    }

    // ==========================================
    // CUMUL - ETAPE 2 : SOURCE 2 (Ransomware.live - flux brut GitHub)
    // ==========================================
    console.log(`Connexion Source 2 : ${RANSOM_LIVE_RAW}`);
    try {
        const res2 = await fetch(RANSOM_LIVE_RAW, FETCH_HEADERS);
        if (res2.status === 200) {
            let attacks = await res2.json();

            if (attacks && typeof attacks === 'object' && attacks.attacks) {
                attacks = attacks.attacks;
            }

            attacks.sort((a, b) => (b.discovered || "").localeCompare(a.discovered || ""));

            let countSource2 = 0;
            for (const attack of attacks) {
                const dateRaw = attack.discovered || "";
                if (!isRecent(dateRaw)) continue;

                const company = attack.company || attack.post_title || "Cible Inconnue";
                const groupName = (attack.group_name || "UNKNOWN").toUpperCase();

                outputFeed.push({
                    target: sanitizeText(company),
                    hacker: groupName,
                    time: dateRaw,
                    details: buildRecap(sanitizeText(company), groupName, "", false)
                });
                countSource2++;
            }
            console.log(`OK: ${countSource2} éléments (< ${MAX_AGE_HOURS}h) ajoutés depuis Source 2.`);
        }
    } catch (e) {
        console.log(`Note: Échec Source 2 -> ${e.message}`);
    }

    // ==========================================
    // CUMUL - ETAPE 3 : SOURCE 3 (Ransomware.live API v2 - focus FRANCE)
    // ==========================================
    console.log(`Connexion Source 3 (FRANCE) : ${RANSOMLIVE_API_FR}`);
    try {
        const res3 = await fetch(RANSOMLIVE_API_FR, FETCH_HEADERS);
        if (res3.status === 200) {
            let victims = await res3.json();
            if (Array.isArray(victims)) {
                victims.sort((a, b) => (b.attackdate || "").localeCompare(a.attackdate || ""));

                let countSource3 = 0;
                for (const v of victims) {
                    const dateRaw = v.attackdate || v.discovered || "";
                    if (!isRecent(dateRaw)) continue;

                    const target = sanitizeText(v.victim || v.post_title || "Cible Inconnue");
                    const group = (v.group || v.group_name || "unknown").toUpperCase();
                    const secteur = v.activity && v.activity.toLowerCase() !== "not found" ? v.activity : "";

                    outputFeed.push({
                        target: target,
                        hacker: group,
                        time: dateRaw,
                        details: buildRecap(target, group, secteur, true),
                        country: "FR"
                    });
                    countSource3++;
                }
                console.log(`OK: ${countSource3} éléments France (< ${MAX_AGE_HOURS}h) chargés depuis Source 3.`);
            }
        } else {
            console.log(`Note: Source 3 a répondu avec le statut ${res3.status}`);
        }
    } catch (e) {
        console.log(`Note: Échec Source 3 -> ${e.message}`);
    }

    // ==========================================
    // CUMUL - ETAPE 4 : SOURCE 4 (RansomLook - tracker indépendant, posts récents)
    // ==========================================
    console.log(`Connexion Source 4 : ${RANSOMLOOK_API}`);
    try {
        const res4 = await fetch(RANSOMLOOK_API, FETCH_HEADERS);
        if (res4.status === 200) {
            let posts = await res4.json();
            if (Array.isArray(posts)) {
                posts.sort((a, b) => (b.discovered || "").localeCompare(a.discovered || ""));

                let countSource4 = 0;
                for (const post of posts) {
                    const dateRaw = post.discovered || "";
                    if (!isRecent(dateRaw)) continue;

                    const title = sanitizeText(post.post_title || post.victim || "Cible Inconnue");
                    const group = (post.group_name || "unknown").toUpperCase();

                    outputFeed.push({
                        target: title,
                        hacker: group,
                        time: dateRaw,
                        details: buildRecap(title, group, "", false)
                    });
                    countSource4++;
                }
                console.log(`OK: ${countSource4} éléments (< ${MAX_AGE_HOURS}h) chargés depuis Source 4.`);
            }
        } else {
            console.log(`Note: Source 4 a répondu avec le statut ${res4.status}`);
        }
    } catch (e) {
        console.log(`Note: Échec Source 4 -> ${e.message}`);
    }

    // ==========================================
    // FUSION, PRIORISATION FRANCE, TRI CHRONOLOGIQUE ET DEDUPLICATION
    // ==========================================
    if (outputFeed.length === 0) {
        console.error(`ERREUR CRITIQUE: Aucune donnée récupérée dans la fenêtre des ${MAX_AGE_HOURS}h.`);
        process.exit(1);
    }

    // Priorité : les cibles françaises remontent en tête, puis tri chronologique décroissant
    outputFeed.sort((a, b) => {
        const aFR = a.country === "FR" ? 1 : 0;
        const bFR = b.country === "FR" ? 1 : 0;
        if (aFR !== bFR) return bFR - aFR;
        return (b.time || "").localeCompare(a.time || "");
    });

    // Déduplication stricte par entreprise (garde la première occurrence, déjà triée)
    const seen = new Set();
    const result = [];
    for (const item of outputFeed) {
        const lookupKey = item.target.toLowerCase().trim();
        if (!seen.has(lookupKey)) {
            seen.add(lookupKey);
            result.push(item);
        }
    }

    // Aucun plafond arbitraire : tout ce qui est < 72h et dédupliqué est publié.
    console.log(`Écriture finale dans live-feed.json (${result.length} éléments, toutes < ${MAX_AGE_HOURS}h, France en priorité)...`);
    fs.writeFileSync("live-feed.json", JSON.stringify(result, null, 4), 'utf-8');
    console.log("--- PIPELINE NODE.JS MULTI-SOURCE TERMINE ---");
}

getCyberFeed();
                    
