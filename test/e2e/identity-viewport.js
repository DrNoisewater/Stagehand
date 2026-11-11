document.getElementById('size').onchange = e => { const [w,h]=e.target.value.split(' × ');const frame=document.querySelector('iframe');frame.width=w;frame.height=h; };
