import csv
import re

# Parse CSV distribution
distribution = {}
with open('axtverteilung.csv', 'r', encoding='utf-8') as f:
    reader = csv.DictReader(f, delimiter=';')
    for row in reader:
        player = row.get('Thiny Skinny Vince, the Escalating One', row.get('Name', '')).strip()
        if not player:
            for key in row:
                if key == 'Name':
                    player = row.get(key, '').strip()
                    break
        if not player:
            continue
            
        distribution[player] = {
            'Mystic': int(row.get('Mystic Rare Axt', '0').strip()),
            'Rare': int(row.get('Rare Axt', '0').strip()),
            'Uncommon': int(row.get('Uncommon Axt', '0').strip()),
            'Common': int(row.get('Common Axt', '0').strip())
        }

print("Distribution parsed:")
for player, counts in distribution.items():
    print(f"{player}: {counts}")

# Read HTML
with open('index.html', 'r', encoding='utf-8') as f:
    content = f.read()

# Define axe icon mapping
axe_icons = {
    'Mystic': 'SLG_Shirts_axe_mythic.png',
    'Rare': 'SLG_Shirts_axe_rare.png',
    'Uncommon': 'SLG_Shirts_axe_uncommon.png',
    'Common': 'SLG_Shirts_axe_common.png'
}

# Update axe collections in eternal ranking
for player, counts in distribution.items():
    if any(counts.values()) > 0:
        # Generate axe HTML
        axe_html = f'<span class="axe-collection">'
        if counts['Mystic'] > 0:
            axe_html += ''.join([f'<img src="{axe_icons["Mystic"]}" class="axe-icon" alt="Mystic">' for _ in range(counts['Mystic'])])
        if counts['Rare'] > 0:
            axe_html += ''.join([f'<img src="{axe_icons["Rare"]}" class="axe-icon" alt="Rare">' for _ in range(counts['Rare'])])
        if counts['Uncommon'] > 0:
            axe_html += ''.join([f'<img src="{axe_icons["Uncommon"]}" class="axe-icon" alt="Uncommon">' for _ in range(counts['Uncommon'])])
        if counts['Common'] > 0:
            axe_html += ''.join([f'<img src="{axe_icons["Common"]}" class="axe-icon" alt="Common">' for _ in range(counts['Common'])])
        axe_html += '</span>'
        
        # Find and replace
        pattern = rf'(<span class="name">{re.escape(player)}</span>\s+<span class="axe-collection">)(.*?)(</span>)'
        content = re.sub(pattern, rf'\1{axe_html}\3', content, flags=re.DOTALL)
        print(f"Updated {player} with counts")
    else:
        # Ensure empty collection
        pattern = rf'(<span class="name">{re.escape(player)}</span>\s+<span class="axe-collection">)(.*?)(</span>)'
        content = re.sub(pattern, r'\1\3', content, flags=re.DOTALL)
        print(f"Cleared {player} axes")

# Write back
with open('index.html', 'w', encoding='utf-8') as f:
    f.write(content)

print("\n✅ Eternal Ranking distribution updated!")