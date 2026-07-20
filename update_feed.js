const fs = require('fs');
const fetch = require('node-fetch');

// ==========================================
// SOURCES (6 au total, pour la redondance : si une source est en panne
// ou peu active, les 5 autres compensent)
// ==========================================
const POSTS_URL = "https://raw.githubusercontent.com/cyberiskvision/dls-monitor/main/posts.json";
const RANSOM_LIVE_RAW = "https://raw.githubusercontent.com/Casualtek/Ransomware.live/main/posts.json";
const RANSOMLIVE_API_FR = "https://api.ransomware.live/v2/countryvictims/FR";
const RANSOMLIVE_API_RECENT = "https://api.ransomware.live/v2/recentvictims";
const RANSOMLIVE_API_PRESS = "https://api.ransomware.live/v2/recentcyberattacks";
const RANSOMLOOK_API = "https://www.ransomlook.io/api/posts?days=7";

const FETCH_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CyberMonitorFR/1.0)' } };

// Fenêtre de fraîcheur cible : 7 jours. Si trop peu de résultats passent ce filtre,
// un filet de sécurité automatique élargit la sélection (voir applyFreshnessFilter).
const TARGET_WINDOW_HOURS = 24 * 7;
const MIN_ALERTS_EXPECTED = 15;

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

const PRESS_TEMPLATES = [
    (t, g) => `📰 Fuite de données confirmée par la presse : ${t} aurait été compromise, incident attribué à ${g}.`,
    (t, g) => `Alerte médiatique : une cyberattaque visant ${t} fait la une, ${g} pointé du doigt.`,
    (t, g) => `${t} au cœur d'un signalement presse pour une possible violation de données liée à ${g}.`
];

function buildRecap(target, group, secteur, isFrance, isPress) {
    if (isFrance) {
        const secteurTxt = secteur ? ` (secteur ${secteur})` : "";
        return sanitizeText(pick(FRANCE_TEMPLATES)(target, group, secteurTxt));
    }
    if (isPress) {
        return sanitizeText(pick(PRESS_TEMPLATES)(target, group));
    }
    return sanitizeText(pick(GENERIC_TEMPLATES)(target, group));
}

// Parsing de date tolérant : ajoute un 'Z' si la chaîne ressemble à une date ISO
// sans fuseau horaire, pour éviter les décalages d'interprétation locale/UTC.
function parseDateSafe(dateStr) {
    if (!dateStr) return null;
    let s = String(dateStr).trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s)) s += 'Z';
    const t = Date.parse(s);
    return isNaN(t) ? null : t;
}

function ageHours(dateStr) {
    const t = parseDateSafe(dateStr);
    if (t === null) return null;
    return (Date.now() - t) / 3600000;
}

async function safeFetchJson(url, label) {
    try {
        const res = await fetch(url, FETCH_HEADERS);
        if (res.status !== 200) {
            console.log(`Note: ${label} a répondu avec le statut ${res.status}`);
            return null;
        }
        const data = await res.json();
        return data;
    } catch (e) {
        console.log(`Note: Échec ${label} -> ${e.message}`);
        return null;
    }
}

async function getCyberFeed() {
    console.log("--- DEBUT DE L'EXTRACTION MULTI-SOURCES (6 sources, fenêtre cible 7 jours) ---");
    let outputFeed = [];

    // ---------- SOURCE 1 : Cyberisk ----------
    console.log(`Connexion Source 1 : ${POSTS_URL}`);
    const s1 = await safeFetchJson(POSTS_URL, "Source 1 (Cyberisk)");
    if (Array.isArray(s1)) {
        let count = 0;
        for (const post of s1) {
            const title = post.post_title || "Cible Inconnue";
            const group = (post.group_name || "unknown").toUpperCase();
            const dateRaw = post.discovered || "";
            const t = sanitizeText(title);
            outputFeed.push({ target: t, hacker: group, time: dateRaw, details: buildRecap(t, group, "", false, false) });
            count++;
        }
        console.log(`OK: ${count} éléments récupérés depuis Source 1.`);
    }

    // ---------- SOURCE 2 : Ransomware.live (mirror GitHub) ----------
    console.log(`Connexion Source 2 : ${RANSOM_LIVE_RAW}`);
    let s2 = await safeFetchJson(RANSOM_LIVE_RAW, "Source 2 (Ransomware.live mirror)");
    if (s2 && typeof s2 === 'object' && s2.attacks) s2 = s2.attacks;
    if (Array.isArray(s2)) {
        let count = 0;
        for (const attack of s2) {
            const company = attack.company || attack.post_title || "Cible Inconnue";
            const groupName = (attack.group_name || "UNKNOWN").toUpperCase();
            const dateRaw = attack.discovered || "";
            const t = sanitizeText(company);
            outputFeed.push({ target: t, hacker: groupName, time: dateRaw, details: buildRecap(t, groupName, "", false, false) });
            count++;
        }
        console.log(`OK: ${count} éléments récupérés depuis Source 2.`);
    }

    // ---------- SOURCE 3 : Ransomware.live API - focus FRANCE ----------
    console.log(`Connexion Source 3 (FRANCE) : ${RANSOMLIVE_API_FR}`);
    const s3 = await safeFetchJson(RANSOMLIVE_API_FR, "Source 3 (Ransomware.live FR)");
    if (Array.isArray(s3)) {
        let count = 0;
        for (const v of s3) {
            const target = sanitizeText(v.victim || v.post_title || "Cible Inconnue");
            const group = (v.group || v.group_name || "unknown").toUpperCase();
            const dateRaw = v.attackdate || v.discovered || "";
            const secteur = v.activity && v.activity.toLowerCase() !== "not found" ? v.activity : "";
            outputFeed.push({ target, hacker: group, time: dateRaw, details: buildRecap(target, group, secteur, true, false), country: "FR" });
            count++;
        }
        console.log(`OK: ${count} éléments France récupérés depuis Source 3.`);
    }

    // ---------- SOURCE 4 : Ransomware.live API - victimes récentes (monde) ----------
    console.log(`Connexion Source 4 : ${RANSOMLIVE_API_RECENT}`);
    const s4 = await safeFetchJson(RANSOMLIVE_API_RECENT, "Source 4 (Ransomware.live recentvictims)");
    if (Array.isArray(s4)) {
        let count = 0;
        for (const v of s4) {
            const target = sanitizeText(v.victim || v.post_title || "Cible Inconnue");
            const group = (v.group || v.group_name || "unknown").toUpperCase();
            const dateRaw = v.attackdate || v.discovered || "";
            const isFR = v.country === "FR";
            const secteur = v.activity && v.activity.toLowerCase() !== "not found" ? v.activity : "";
            outputFeed.push({
                target, hacker: group, time: dateRaw,
                details: buildRecap(target, group, secteur, isFR, false),
                ...(isFR ? { country: "FR" } : {})
            });
            count++;
        }
        console.log(`OK: ${count} éléments récupérés depuis Source 4.`);
    }

    // ---------- SOURCE 5 : Ransomware.live API - cyberattaques presse (data leaks / hacking) ----------
    console.log(`Connexion Source 5 : ${RANSOMLIVE_API_PRESS}`);
    const s5 = await safeFetchJson(RANSOMLIVE_API_PRESS, "Source 5 (Ransomware.live press)");
    if (Array.isArray(s5)) {
        let count = 0;
        for (const item of s5) {
            const target = sanitizeText(item.victim || item.title || item.post_title || "Cible Inconnue");
            const group = (item.group || item.group_name || item.source || "INCONNU").toString().toUpperCase();
            const dateRaw = item.date || item.discovered || item.attackdate || "";
            outputFeed.push({ target, hacker: group, time: dateRaw, details: buildRecap(target, group, "", false, true) });
            count++;
        }
        console.log(`OK: ${count} éléments récupérés depuis Source 5.`);
    }

    // ---------- SOURCE 6 : RansomLook ----------
    console.log(`Connexion Source 6 : ${RANSOMLOOK_API}`);
    const s6 = await safeFetchJson(RANSOMLOOK_API, "Source 6 (RansomLook)");
    if (Array.isArray(s6)) {
        let count = 0;
        for (const post of s6) {
            const title = sanitizeText(post.post_title || post.victim || "Cible Inconnue");
            const group = (post.group_name || "unknown").toUpperCase();
            const dateRaw = post.discovered || "";
            outputFeed.push({ target: title, hacker: group, time: dateRaw, details: buildRecap(title, group, "", false, false) });
            count++;
        }
        console.log(`OK: ${count} éléments récupérés depuis Source 6.`);
    }

    if (outputFeed.length === 0) {
        console.error("ERREUR CRITIQUE: Aucune donnée récupérée sur l'ensemble des 6 sources.");
        process.exit(1);
    }

    console.log(`Total brut cumulé (avant filtre de fraîcheur) : ${outputFeed.length} éléments.`);

    // ==========================================
    // FILTRE DE FRAÎCHEUR AVEC FILET DE SÉCURITÉ
    // On vise 7 jours. Si ça laisse trop peu d'alertes (< MIN_ALERTS_EXPECTED),
    // on élargit automatiquement pour ne jamais publier un flux presque vide.
    // ==========================================
    function applyFreshnessFilter(items, windowHours) {
        return items.filter(it => {
            const h = ageHours(it.time);
            // Si la date est absente/imparsable, on garde l'élément (mieux vaut l'afficher
            // sans certitude d'âge que de perdre une source entière qui a un format différent).
            if (h === null) return true;
            return h >= -1 && h <= windowHours; // tolérance -1h pour les décalages d'horloge
        });
    }

    let filtered = applyFreshnessFilter(outputFeed, TARGET_WINDOW_HOURS);
    console.log(`Après filtre ${TARGET_WINDOW_HOURS / 24} jours : ${filtered.length} éléments.`);

    if (filtered.length < MIN_ALERTS_EXPECTED) {
        console.log(`Filet de sécurité activé : moins de ${MIN_ALERTS_EXPECTED} alertes récentes, élargissement automatique de la fenêtre.`);
        filtered = applyFreshnessFilter(outputFeed, TARGET_WINDOW_HOURS * 4); // ~28 jours
        if (filtered.length < MIN_ALERTS_EXPECTED) {
            // Dernier recours : on prend tout le flux brut cumulé, trié par fraîcheur, sans limite d'âge.
            console.log("Filet de sécurité niveau 2 : utilisation de l'intégralité du flux cumulé (sans limite d'âge).");
            filtered = outputFeed;
        }
    }

    // ==========================================
    // TRI CHRONOLOGIQUE (le plus récent en premier) + LÉGER BOOST FRANCE
    // Le boost ne fait remonter une alerte France que si elle est à moins de 6h
    // de la plus fraîche du flux — elle ne peut plus masquer des alertes bien plus récentes.
    // ==========================================
    const FRANCE_BOOST_MS = 6 * 3600 * 1000;
    filtered.sort((a, b) => {
        const ta = (parseDateSafe(a.time) || 0) + (a.country === "FR" ? FRANCE_BOOST_MS : 0);
        const tb = (parseDateSafe(b.time) || 0) + (b.country === "FR" ? FRANCE_BOOST_MS : 0);
        return tb - ta;
    });

    const seen = new Set();
    const result = [];
    for (const item of filtered) {
        const lookupKey = item.target.toLowerCase().trim();
        if (!seen.has(lookupKey)) {
            seen.add(lookupKey);
            result.push(item);
        }
    }

    console.log(`Écriture finale dans live-feed.json (${result.length} éléments, France en priorité)...`);
    fs.writeFileSync("live-feed.json", JSON.stringify(result, null, 4), 'utf-8');
    console.log("--- PIPELINE NODE.JS MULTI-SOURCE TERMINE ---");
}

getCyberFeed();
            
