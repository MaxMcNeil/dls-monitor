import requests
import json
import re
import sys
import os
from transformers import pipeline

# Configuration absolue du dossier de cache IA pour GitHub Actions
CACHE_DIR = "/home/runner/.cache/huggingface"
os.environ["HF_HOME"] = CACHE_DIR

# SOURCE 1 (Cyberiskvision)
POSTS_URL = "https://raw.githubusercontent.com/cyberiskvision/dls-monitor/main/posts.json"

# SOURCE 2 (Ransomware.live API - Ultra réactive)
RANSOM_LIVE_API = "https://api.ransomware.live/recent"

# Variable globale pour l'instance de traduction unique (Singleton)
translator_instance = None

def translate_text(text):
    """Traduit du texte de l'anglais vers le français en utilisant Meta NLLB-200 hors-ligne"""
    global translator_instance
    if not text:
        return ""
    try:
        if translator_instance is None:
            print("Initialisation du modèle de traduction Meta NLLB-200 (CPU)...")
            # Initialisation du pipeline de traduction de Hugging Face
            translator_instance = pipeline(
                "translation", 
                model="Xenova/nllb-200-distilled-600M", 
                model_kwargs={"cache_dir": CACHE_DIR}
            )
        
        # eng_Latn = Anglais / fra_Latn = Français
        res = translator_instance(text, src_lang="eng_Latn", tgt_lang="fra_Latn")
        return res[0]['translation_text']
    except Exception as e:
        print(f"[Translation Fallback] Erreur IA, texte original conservé : {e}")
        return text

def sanitize_text(text):
    if not text: return ""
    text = re.sub(r'leak|leaked|stolen', 'Shared Context', text, flags=re.IGNORECASE)
    text = re.sub(r'attack|hacked|piraté', 'Incident', text, flags=re.IGNORECASE)
    text = re.sub(r'[\w\.-]+@[\w\.-]+\.\w+', '[EMAIL_PROTECTED]', text)
    text = re.sub(r'\+?\d{10,13}', '[PHONE_PROTECTED]', text)
    return text.strip()

def get_cyber_feed():
    print("--- DEBUT DE L'EXTRACTION MULTI-SOURCES (CUMUL ET TRADUCTION) ---")
    output_feed = []

    # ==========================================
    # CUMUL - ETAPE 1 : AJOUT DE LA SOURCE 1
    # ==========================================
    print(f"Connexion Source 1 : {POSTS_URL}")
    try:
        response = requests.get(POSTS_URL, timeout=12)
        if response.status_code == 200:
            posts = response.json()
            posts.sort(key=lambda x: x.get("discovered", ""), reverse=True)
            
            for post in posts[:15]:
                title = post.get("post_title", "Cible Inconnue")
                group = post.get("group_name", "unknown")
                date_raw = post.get("discovered", "")
                
                # Création du texte de base et traduction instantanée en français
                raw_details = f"Major alert: The organization {title} is targeted by the cyber group {group.upper()}."
                details_fr = translate_text(raw_details)

                output_feed.append({
                    "target": sanitize_text(title),
                    "hacker": group.upper(),
                    "time": date_raw,
                    "details": sanitize_text(details_fr)
                })
            print(f"OK: {len(output_feed)} éléments ajoutés depuis Source 1.")
    except Exception as e:
        print(f"Note: Échec Source 1 -> {e}")

    # ==========================================
    # CUMUL - ETAPE 2 : AJOUT DE LA SOURCE 2
    # ==========================================
    print(f"Connexion Source 2 : {RANSOM_LIVE_API}")
    try:
        res2 = requests.get(RANSOM_LIVE_API, timeout=12)
        if res2.status_code == 200:
            attacks = res2.json()
            if isinstance(attacks, dict):
                attacks = attacks.get("attacks", [])
                
            attacks.sort(key=lambda x: x.get("discovered", ""), reverse=True)
            
            count_source2 = 0
            for attack in attacks[:20]: 
                company = attack.get("company", "Cible Inconnue")
                group_name = attack.get("group_name", "UNKNOWN")
                
                # Création du texte brut en anglais pour l'API Ransomware.live et passage dans l'IA
                raw_details = f"Ransomware incident detected on infrastructures. Claimed by {group_name.upper()}."
                details_fr = translate_text(raw_details)
                
                output_feed.append({
                    "target": sanitize_text(company),
                    "hacker": group_name.upper(),
                    "time": attack.get("discovered", ""),
                    "details": sanitize_text(details_fr)
                })
                count_source2 += 1
            print(f"OK: {count_source2} éléments ajoutés depuis Source 2.")
    except Exception as e:
        print(f"Note: Échec Source 2 -> {e}")

    # ==========================================
    # FUSION, TRI CHRONOLOGIQUE ET INTERSECTION
    # ==========================================
    if not output_feed:
        print("ERREUR CRITIQUE: Aucune donnée récupérée.")
        sys.exit(1)

    # Tri global chronologique
    output_feed.sort(key=lambda x: x.get("time", ""), reverse=True)

    # Déduplication
    seen = set()
    final_clean_feed = []
    for item in output_feed:
        lookup_key = item["target"].lower().strip()
        if lookup_key not in seen:
            seen.add(lookup_key)
            final_clean_feed.append(item)

    final_clean_feed = final_clean_feed[:20]

    print(f"Écriture finale dans live-feed.json ({len(final_clean_feed)} éléments cumulés et traduits)...")
    with open("live-feed.json", "w", encoding="utf-8") as f:
        json.dump(final_clean_feed, f, ensure_ascii=False, indent=4)
        
    print("--- PIPELINE MULTI-SOURCE ET TRADUCTION TERMINE ---")

if __name__ == "__main__":
    get_cyber_feed()
            
