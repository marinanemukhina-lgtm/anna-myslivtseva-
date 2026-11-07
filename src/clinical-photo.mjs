// Synthetic cabinet photos are stored in this browser only.
export const MAX_PHOTO_DATA_LENGTH=1400000;
const SCALES=[1,0.8,0.64,0.512,0.4];
const QUALITIES=[0.85,0.75,0.65,0.55];
export function encodeClinicalPhoto(image,createCanvas=()=>document.createElement('canvas')){
  const width=image?.naturalWidth,height=image?.naturalHeight;
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw Error('PHOTO_DECODE_FAILED');
  const canvas=createCanvas();
  try{
    const context=canvas.getContext('2d');
    if(!context)throw Error('PHOTO_ENCODING_FAILED');
    const scale=Math.min(1,1600/Math.max(width,height));
    for(const factor of SCALES){
      canvas.width=Math.max(1,Math.round(width*scale*factor));
      canvas.height=Math.max(1,Math.round(height*scale*factor));
      context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);
      for(const quality of QUALITIES){
        const data=canvas.toDataURL('image/jpeg',quality);
        if(typeof data!=='string'||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(data))throw Error('PHOTO_ENCODING_FAILED');
        if(data.length<=MAX_PHOTO_DATA_LENGTH)return data;
      }
    }
    throw Error('PHOTO_TOO_LARGE');
  }finally{canvas.width=0;canvas.height=0;}
}
