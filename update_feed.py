import requests
import json
import re
import sys
from bs4 import BeautifulSoup

POSTS_URL = "https://raw.githubusercontent.com/cyberiskvision/dls-monitor/main/posts.json"
API_SOURCE_URL = "https://api.github.com/repos/cyberiskvision/dls-monitor/contents/source"
RAW_SOURCE_URL = "https://raw.githubusercontent.com/cyberiskvision/dls-monitor/main/source/"

def sanitize_text(text):
    if not text: return ""
    text = re.sub(r'leak|leaked|stolen', 'Shared Context', text, flags=re.IGNORECASE)
    text = re.sub(r'attack|hacked|piraté', 'Incident', text, flags=re.IGNORECASE)
    text = re.sub(r'[\w\.-]+@[\w\.-]+\.\w+', '[EMAIL_PROTECTED]', text)
    text = re.sub(r'\+?\d{10,13}', '[PHONE_PROTECTED]', text)
    return text.strip()

def get_cyber_feed():
    print("--- DEBUT DE L'EXTRACTION ---")
    print(f"Connexion à l'API source: {POSTS_URL}")
    
    try:
        response = requests.get(POSTS_URL, timeout=15)
        response.raise_for_status()
        posts = response.json()
        print(f"OK: {len(posts)} posts récupérés depuis la source.")
    except Exception as e:
        print(f"ERREUR CRITIQUE FLUX SOURCE: Impossible de lire posts.json -> {e}")
        sys.exit(1) # Force l'action GitHub à passer au rouge pour te prévenir !

    if not posts:
        print("ERREUR: Le fichier posts.json reçu est vide !")
        sys.exit(1)

    # Tri par date de détection
    posts.sort(key=lambda x: x.get("discovered", ""), reverse=True)
    
    output_feed = []
    
    print("Traitement des 10 premières alertes...")
    for index, post in enumerate(posts[:10]):
        title = post.get("post_title", "Cible Inconnue")
        group = post.get("group_name", "unknown")
        date_raw = post.get("discovered", "")
        
        print(f"[{index+1}/10] Traitement de {title} par {group} ({date_raw})")
        details = "Analyse en cours..."
        
        try:
            url_appel = f"{API_SOURCE_URL}/{group}"
            dir_res = requests.get(url_appel, timeout=10)
            if dir_res.status_code == 200:
                files = dir_res.json()
                if files:
                    matched_file = files[-1]['name']
                    raw_html_url = f"{RAW_SOURCE_URL}{group}/{matched_file}"
                    html_content = requests.get(raw_html_url, timeout=10).text
                    
                    soup = BeautifulSoup(html_content, 'html.parser')
                    for script in soup(["script", "style"]):
                        script.decompose()
                    details = sanitize_text(soup.get_text(separator=' '))[:350] + "..."
            else:
                print(f"   -> Code API {dir_res.status_code} pour le groupe {group}")
        except Exception as e:
            print(f"   -> Erreur détails pour {group}: {e}")

        output_feed.append({
            "target": sanitize_text(title),
            "hacker": group.upper(),
            "time": date_raw,
            "details": details
        })
    
    print(f"Écriture finale dans live-feed.json ({len(output_feed)} éléments)...")
    try:
        with open("live-feed.json", "w", encoding="utf-8") as f:
            json.dump(output_feed, f, ensure_ascii=False, indent=4)
        print("--- TOUT EST OK: live-feed.json mis à jour avec succès ---")
    except Exception as e:
        print(f"ERREUR ECRITURE FICHIER: {e}")
        sys.exit(1)

if __name__ == "__main__":
    get_cyber_feed()
