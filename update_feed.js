const fs = require('fs');
const fetch = require('node-fetch');

// Configuration absolue pour l'environnement CI/CD
const CACHE_DIR = "/home/runner/.cache/huggingface";

// URLs des sources
const POSTS_URL = "https://raw.githubusercontent.com/cyberiskvision/dls-monitor/main/posts.json";
const RANSOM_LIVE_RAW = "https://raw.githubusercontent.com/Casualtek/Ransomware.live/main/posts.json";

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
    // CUMUL - ETAPE 1 : AJOUT DE LA SOURCE 1 (Cyberisk)
    // ==========================================
    console.log(`Connexion Source 1 : ${POSTS_URL}`);
    try {
        const response = await fetch(POSTS_URL);
        if (response.status === 200) {
            let posts = await response.json();
            posts.sort((a, b) => b.discovered.localeCompare(a.discovered));

            // Optimisation : On prend le top 30 des plus frais pour garantir le tri final
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
    // CUMUL - ETAPE 2 : AJOUT DE LA SOURCE 2 (Ransomware.live)
    // ==========================================
    console.log(`Connexion Source 2 : ${RANSOM_LIVE_RAW}`);
    try {
        const res2 = await fetch(RANSOM_LIVE_RAW);
        if (res2.status === 200) {
            let attacks = await res2.json();
            
            if (attacks && typeof attacks === 'object' && attacks.attacks) {
                attacks = attacks.attacks;
            }
            
            attacks.sort((a, b) => b.discovered.localeCompare(a.discovered));

            let countSource2 = 0;
            // Optimisation : On prend le top 35 des plus frais
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
    // FUSION, TRI CHRONOLOGIQUE ET INTERSECTION
    // ==========================================
    if (outputFeed.length === 0) {
        console.error("ERREUR CRITIQUE: Aucune donnée récupérée.");
        process.exit(1);
    }

    // Tri chronologique global (les plus récents en premier)
    outputFeed.sort((a, b) => b.time.localeCompare(a.time));

    // Déduplication stricte par entreprise
    const seen = new Set();
    const finalCleanFeed = [];
    for (const item of outputFeed) {
        const lookupKey = item.target.toLowerCase().trim();
        if (!seen.has(lookupKey)) {
            seen.add(lookupKey);
            
            // Suppression définitive de la date pour le fichier final
            const { time, ...itemWithoutTime } = item;
            finalCleanFeed.push(itemWithoutTime);
        }
    }

    // Sécurité : On s'assure d'afficher entre 50 et 100 alertes sur le live
    const totalCount = Math.min(Math.max(finalCleanFeed.length, 50), 100);
    const result = finalCleanFeed.slice(0, totalCount);

    console.log(`Écriture finale dans live-feed.json (${result.length} éléments cumulés sans date)...`);
    fs.writeFileSync("live-feed.json", JSON.stringify(result, null, 4), 'utf-8');
    console.log("--- PIPELINE NODE.JS MULTI-SOURCE ET TRADUCTION TERMINE ---");
}

getCyberFeed();
