# Shrinks a PDF for the Craft backup (Craft caps uploads at 5 MB): re-encodes large images as JPEG.
# Usage: python3 tools/shrink-pdf.py in.pdf out.pdf <max px> <jpeg quality>
import warnings; warnings.filterwarnings("ignore")
import sys, io, pikepdf
from PIL import Image
from pikepdf import PdfImage, Name
src,dst,maxpx,q=sys.argv[1],sys.argv[2],int(sys.argv[3]),int(sys.argv[4])
pdf=pikepdf.open(src); done=set()
for page in pdf.pages:
  for name,img in list(page.images.items()):
    if img.objgen in done: continue
    done.add(img.objgen)
    try:
      pi=PdfImage(img)
      if img.get('/SMask') is not None or pi.width*pi.height<400*400: continue
      im=pi.as_pil_image().convert('RGB')
    except Exception as e: continue
    if max(im.size)>maxpx: im.thumbnail((maxpx,maxpx))
    b=io.BytesIO(); im.save(b,'JPEG',quality=q,optimize=True)
    if len(b.getvalue())>=len(img.read_raw_bytes()): continue
    img.write(b.getvalue(),filter=Name.DCTDecode)
    img.Width,img.Height=im.size; img.ColorSpace=Name.DeviceRGB; img.BitsPerComponent=8
    for k in ('/DecodeParms','/Decode'):
      if k in img: del img[k]
pdf.save(dst,compress_streams=True,object_stream_mode=pikepdf.ObjectStreamMode.generate)
