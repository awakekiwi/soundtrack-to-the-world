# Optional 8K earth maps

Put these two files in this folder to make the globe crisp when zoomed right in.
The app fetches them only when you zoom in close, on a computer (phones stay on
the lighter 4K maps). If they're missing, nothing breaks.

1. Go to https://www.solarsystemscope.com/textures/
2. Under **Earth**, download the **8K** versions of:
   - **Earth Day Map** → save as `8k_earth_daymap.jpg`
   - **Earth Night Map** → save as `8k_earth_nightmap.jpg`
3. Put both files in this `public/textures/` folder, then `git add`, commit and push.

The file names must match exactly. Together they're roughly 6–8 MB.

Each file works on its own. The 8K day map is satellite-style, which looks
different from the relief-style 4K day map the app uses (the same one as Sun
Chaser). If you prefer that look, add only the night map: you get sharper city
lights and keep the relief day map.

Credit: textures by Solar System Scope (https://www.solarsystemscope.com/textures/),
licensed CC BY 4.0. The app shows this credit on the globe.
