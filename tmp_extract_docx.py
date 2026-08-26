import zipfile, re

path = r"C:\Users\Administrator\Desktop\API中转系统\密钥池中转站-需求文档与开发提示词.docx"
z = zipfile.ZipFile(path)
xml = z.read("word/document.xml").decode("utf-8", "ignore")
paras = re.split(r"</w:p>", xml)
out = []
for p in paras:
    texts = re.findall(r"<w:t[^>]*>(.*?)</w:t>", p, re.S)
    line = "".join(texts)
    line = re.sub(r"<[^>]+>", "", line)
    out.append(line)
text = "\n".join(out)
print(text)
