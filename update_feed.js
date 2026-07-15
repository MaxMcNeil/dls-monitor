const fs = require('fs');
const fetch = require('node-fetch');

// Configuration absolue pour l'environnement CI/CD
const CACHE_DIR = "/home/runner/.cache/huggingface";

// URLs des sources
const POSTS_URL = "https://raw.githubusercontent.com/cyberiskvision/dls-monitor/main/posts.json";
const RANSOM_LIVE_RAW = "https://raw.githubusercontent.com/Casualtek/Ransomware.live/main/posts.json";
const RANSOMLIVE_API_FR = "https://api.ransomware.live/v2/countryvictims/FR";
const RANSOMLOOK_API = "https://www.ransomlook.io/api/posts?days=3";

// Un User-Agent générique évite les blocages 403 de certaines API publiques
const FETCH_HEADERS = { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CyberMonitorFR/1.0)' } };

function sanitizeText(text) {
    if (!text) return "";
    return text
        .replace(/leak|leaked|stolen/gi, 'Shared Context')
        .replace(/attack|hacked|piraté/gi, 'Incident')
        .replace(/[\w\.-]+@[\w\.-]+\.\w+/g, '[EMAIL_PROTECTED]')
        .replace(/\+?\d{10,13}/g, '[PHONE_PROTECTED]')
        .trim();
}

let translatorInstance = null;
// Cache mémoire pour éviter de retraduire les chaînes identiques
const translationCache = new Map();

async function translateText(text) {
    if (!text) return "";
    if (translationCache.has(text)) {
        return translationCache.get(text);
    }

    try {
        const { pipeline, env } = await import('@xenova/transformers');

        env.allowLocalFiles = true;
        env.allowRemoteFiles = true;
        env.cacheDir = CACHE_DIR;

        if (!translatorInstance) {
            console.log("Initialisation du modèle de traduction ONNX Meta NLLB-200 (CPU)...");
            translatorInstance = await pipeline('translation', 'Xenova/nllb-200-distilled-600M', {
                cache_dir: CACHE_DIR,
                local_files_only: false
            });
        }

        const output = await translatorInstance(text, {
            src_lang: 'eng_Latn',
            tgt_lang: 'fra_Latn',
        });

        const translated = output[0]?.translation_text || text;
        translationCache.set(text, translated);
        return translated;
    } catch (e) {
        console.error(`[Translation Fallback] Erreur IA : ${e.message}`);
        return text;
    }
}

async function getCyberFeed() {
    console.log("--- DEBUT DE L'EXTRACTION MULTI-SOURCES NODE.JS (CUMUL ET TRADUCTION) ---");
    let outputFeed = [];

    // ==========================================
    // CUMUL - ETAPE 1 : SOURCE 1 (Cyberisk)
    // ==========================================
    console.log(`Connexion Source 1 : ${POSTS_URL}`);
    try {
        const response = await fetch(POSTS_URL, FETCH_HEADERS);
        if (response.status === 200) {
            let posts = await response.json();
            posts.sort((a, b) => b.discovered.localeCompare(a.discovered));

            const targets = posts.slice(0, 30);
            for (const post of targets) {
                const title = post.post_title || "Cible Inconnue";
                const group = post.group_name || "unknown";
                const dateRaw = post.discovered || "";

                const rawDetails = `Major alert: The organization ${title} is targeted by the cyber group ${group.toUpperCase()}.`;
                const detailsFr = await translateText(rawDetails);

                outputFeed.push({
                    target: sanitizeText(title),
                    hacker: group.toUpperCase(),
                    time: dateRaw,
                    details: sanitizeText(detailsFr)
                });
            }
            console.log(`OK: ${outputFeed.length} éléments chargés depuis Source 1.`);
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

            attacks.sort((a, b) => b.discovered.localeCompare(a.discovered));

            let countSource2 = 0;
            const recentAttacks = attacks.slice(0, 35);
            for (const attack of recentAttacks) {
                const company = attack.company || attack.post_title || "Cible Inconnue";
                const groupName = attack.group_name || "UNKNOWN";

                const rawDetails = `Ransomware incident detected on infrastructures. Claimed by ${groupName.toUpperCase()}.`;
                const detailsFr = await translateText(rawDetails);

                outputFeed.push({
                    target: sanitizeText(company),
                    hacker: groupName.toUpperCase(),
                    time: attack.discovered || "",
                    details: sanitizeText(detailsFr)
                });
                countSource2++;
            }
            console.log(`OK: ${countSource2} éléments ajoutés depuis Source 2.`);
        }
    } catch (e) {
        console.log(`Note: Échec Source 2 -> ${e.message}`);
    }

    // ==========================================
    // CUMUL - ETAPE 3 : SOURCE 3 (Ransomware.live API v2 - focus FRANCE)
    // API officielle, gratuite, sans authentification. Endpoint dédié par pays (ISO2).
    // ==========================================
    console.log(`Connexion Source 3 (FRANCE) : ${RANSOMLIVE_API_FR}`);
    try {
        const res3 = await fetch(RANSOMLIVE_API_FR, FETCH_HEADERS);
        if (res3.status === 200) {
            let victims = await res3.json();
            if (Array.isArray(victims)) {
                victims.sort((a, b) => (b.attackdate || "").localeCompare(a.attackdate || ""));

                const topFR = victims.slice(0, 25);
                let countSource3 = 0;
                for (const v of topFR) {
                    const target = v.victim || v.post_title || "Cible Inconnue";
                    const group = (v.group || v.group_name || "unknown").toUpperCase();
                    const dateRaw = v.attackdate || v.discovered || "";
                    const secteur = v.activity || v.sector || "";

                    // Récap rédigé directement en français (source déjà ciblée France, pas besoin de traduction IA)
                    let recap = `Organisation française revendiquée par le groupe ${group}`;
                    recap += secteur ? ` (secteur : ${secteur}).` : ".";
                    recap += ` Publication détectée sur le site de fuite du groupe.`;

                    outputFeed.push({
                        target: sanitizeText(target),
                        hacker: group,
                        time: dateRaw,
                        details: sanitizeText(recap),
                        country: "FR"
                    });
                    countSource3++;
                }
                console.log(`OK: ${countSource3} éléments France chargés depuis Source 3.`);
            }
        } else {
            console.log(`Note: Source 3 a répondu avec le statut ${res3.status}`);
        }
    } catch (e) {
        console.log(`Note: Échec Source 3 -> ${e.message}`);
    }

    // ==========================================
    // CUMUL - ETAPE 4 : SOURCE 4 (RansomLook - tracker indépendant, posts récents)
    // Croise les données avec Ransomware.live pour combler les angles morts de chaque scraper
    // ==========================================
    console.log(`Connexion Source 4 : ${RANSOMLOOK_API}`);
    try {
        const res4 = await fetch(RANSOMLOOK_API, FETCH_HEADERS);
        if (res4.status === 200) {
            let posts = await res4.json();
            if (Array.isArray(posts)) {
                posts.sort((a, b) => (b.discovered || "").localeCompare(a.discovered || ""));

                const targets4 = posts.slice(0, 30);
                let countSource4 = 0;
                for (const post of targets4) {
                    const title = post.post_title || post.victim || "Cible Inconnue";
                    const group = (post.group_name || "unknown").toUpperCase();
                    const dateRaw = post.discovered || "";

                    const recap = `Nouvelle revendication publiée par le groupe ${group} sur son site de fuite (source croisée : RansomLook).`;

                    outputFeed.push({
                        target: sanitizeText(title),
                        hacker: group,
                        time: dateRaw,
                        details: sanitizeText(recap)
                    });
                    countSource4++;
                }
                console.log(`OK: ${countSource4} éléments chargés depuis Source 4.`);
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
        console.error("ERREUR CRITIQUE: Aucune donnée récupérée.");
        process.exit(1);
    }

    // Priorité : les cibles françaises remontent en tête, puis tri chronologique décroissant
    outputFeed.sort((a, b) => {
        const aFR = a.country === "FR" ? 1 : 0;
        const bFR = b.country === "FR" ? 1 : 0;
        if (aFR !== bFR) return bFR - aFR;
        return (b.time || "").localeCompare(a.time || "");
    });

    // Déduplication stricte par entreprise
    const seen = new Set();
    const finalCleanFeed = [];
    for (const item of outputFeed) {
        const lookupKey = item.target.toLowerCase().trim();
        if (!seen.has(lookupKey)) {
            seen.add(lookupKey);
            finalCleanFeed.push(item);
        }
    }

    // Sécurité : On s'assure d'afficher entre 50 et 100 alertes sur le live
    const totalCount = Math.min(Math.max(finalCleanFeed.length, 50), 100);
    const result = finalCleanFeed.slice(0, totalCount);

    console.log(`Écriture finale dans live-feed.json (${result.length} éléments cumulés, France en priorité)...`);
    fs.writeFileSync("live-feed.json", JSON.stringify(result, null, 4), 'utf-8');
    console.log("--- PIPELINE NODE.JS MULTI-SOURCE ET TRADUCTION TERMINE ---");
}

getCyberFeed();
                                               
