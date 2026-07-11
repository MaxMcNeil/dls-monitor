import requests
import json
import re
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
    print("Tentative de récupération du flux...")
    try:
        response = requests.get(POSTS_URL, timeout=10)
        response.raise_for_status() # Lève une erreur si le site est down
        posts = response.json()
    except Exception as e:
        print(f"CRITIQUE: Impossible de récupérer posts.json: {e}")
        return

    # Tri des posts par date
    posts.sort(key=lambda x: x.get("discovered", ""), reverse=True)
    
    output_feed = []
    
    for post in posts[:10]:
        title = post.get("post_title", "Cible Inconnue")
        group = post.get("group_name", "unknown")
        date_raw = post.get("discovered", "")
        
        details = "Analyse en cours..."
        
        try:
            # Appel API pour le dossier du groupe
            dir_res = requests.get(f"{API_SOURCE_URL}/{group}", timeout=10)
            if dir_res.status_code == 200:
                files = dir_res.json()
                # Logique de match simplifiée
                matched_file = files[-1]['name'] # On prend le plus récent par défaut
                
                raw_html_url = f"{RAW_SOURCE_URL}{group}/{matched_file}"
                html_content = requests.get(raw_html_url, timeout=10).text
                
                soup = BeautifulSoup(html_content, 'html.parser')
                for script in soup(["script", "style"]):
                    script.decompose()
                details = sanitize_text(soup.get_text(separator=' '))[:350] + "..."
        except Exception as e:
            print(f"Note: Impossible de parser le détail pour {group}: {e}")

        output_feed.append({
            "target": sanitize_text(title),
            "hacker": group.upper(),
            "time": date_raw,
            "details": details
        })
    
    # ÉCRITURE FORCÉE
    with open("live-feed.json", "w", encoding="utf-8") as f:
        json.dump(output_feed, f, ensure_ascii=False, indent=4)
    print("SUCCESS: live-feed.json mis à jour.")

if __name__ == "__main__":
    get_cyber_feed()
    
