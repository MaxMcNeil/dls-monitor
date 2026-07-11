import requests
import json
import re
import sys

# SOURCE 1 (Cyberiskvision)
POSTS_URL = "https://raw.githubusercontent.com/cyberiskvision/dls-monitor/main/posts.json"

# SOURCE 2 (Ransomware.live API - Ultra réactive)
RANSOM_LIVE_API = "https://api.ransomware.live/recent"

def sanitize_text(text):
    if not text: return ""
    text = re.sub(r'leak|leaked|stolen', 'Shared Context', text, flags=re.IGNORECASE)
    text = re.sub(r'attack|hacked|piraté', 'Incident', text, flags=re.IGNORECASE)
    text = re.sub(r'[\w\.-]+@[\w\.-]+\.\w+', '[EMAIL_PROTECTED]', text)
    text = re.sub(r'\+?\d{10,13}', '[PHONE_PROTECTED]', text)
    return text.strip()

def get_cyber_feed():
    print("--- DEBUT DE L'EXTRACTION MULTI-SOURCES (CUMUL TOTAL) ---")
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
                details = f"Alerte majeure : L'organisation {title} est ciblée par le groupe cyber {group.upper()}."

                output_feed.append({
                    "target": sanitize_text(title),
                    "hacker": group.upper(),
                    "time": date_raw,
                    "details": details
                })
            print(f"OK: {len(output_feed)} éléments ajoutés depuis Source 1.")
    except Exception as e:
        print(f"Note: Échec Source 1 -> {e}")

    # ==========================================
    # CUMUL - ETAPE 2 : AJOUT DE LA SOURCE 2 (S'Exécute d'office !)
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
            # CUMUL TOTAL : On prend les 20 dernières attaques mondiales sans aucun filtre FR
            for attack in attacks[:20]: 
                company = attack.get("company", "Cible Inconnue")
                group_name = attack.get("group_name", "UNKNOWN")
                
                output_feed.append({
                    "target": sanitize_text(company),
                    "hacker": group_name.upper(),
                    "time": attack.get("discovered", ""),
                    "details": f"Incident ransomware détecté sur les infrastructures. Revendiqué par {group_name.upper()}."
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

    # Tri global chronologique (les plus récents de 2026 en premier, toutes sources confondues)
    output_feed.sort(key=lambda x: x.get("time", ""), reverse=True)

    # Déduplication au cas où la même entreprise est citée dans les deux sources
    seen = set()
    final_clean_feed = []
    for item in output_feed:
        lookup_key = item["target"].lower().strip()
        if lookup_key not in seen:
            seen.add(lookup_key)
            final_clean_feed.append(item)

    # Augmentation de la taille max à 20 éléments pour voir le cumul massif défiler
    final_clean_feed = final_clean_feed[:20]

    print(f"Écriture finale dans live-feed.json ({len(final_clean_feed)} éléments cumulés)...")
    with open("live-feed.json", "w", encoding="utf-8") as f:
        json.dump(final_clean_feed, f, ensure_ascii=False, indent=4)
        
    print("--- PIPELINE MULTI-SOURCE CUMULÉ TERMINÉ ---")

if __name__ == "__main__":
    get_cyber_feed()
                
