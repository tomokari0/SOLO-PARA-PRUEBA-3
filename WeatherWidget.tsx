import React, { useState, useEffect } from 'react';

interface WeatherData {
  temp: number;
  description: string;
  city: string;
  icon: string;
  main: string;
}

const WeatherWidget: React.FC = () => {
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const API_KEY = 'eca1b04af560703134fc2883e0138533';

  useEffect(() => {
    const fetchWeather = async (lat: number, lon: number) => {
      try {
        const response = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${API_KEY}&units=metric&lang=es`
        );
        if (!response.ok) throw new Error('Error al obtener el clima');
        const data = await response.json();
        
        const weatherInfo: WeatherData = {
          temp: Math.round(data.main.temp),
          description: data.weather[0].description,
          city: data.name,
          icon: data.weather[0].icon,
          main: data.weather[0].main,
        };

        setWeather(weatherInfo);
        sessionStorage.setItem('seikotv_weather_data', JSON.stringify(weatherInfo));
      } catch (err) {
        setError('No se pudo cargar el clima');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    const cachedWeather = sessionStorage.getItem('seikotv_weather_data');
    if (cachedWeather) {
      setWeather(JSON.parse(cachedWeather));
      setLoading(false);
    } else {
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (position) => {
            fetchWeather(position.coords.latitude, position.coords.longitude);
          },
          (err) => {
            setError('Geolocalización denegada');
            setLoading(false);
            console.error(err);
          }
        );
      } else {
        setError('Geolocalización no soportada');
        setLoading(false);
      }
    }
  }, []);

  if (loading || error || !weather) return null;

  return (
    <div className="fixed top-28 left-4 z-[60] bg-black/80 backdrop-blur-md border border-red-600/50 rounded-xl p-3 shadow-[0_0_15px_rgba(239,68,68,0.3)] animate-fade-in-up max-w-[180px]">
      <div className="flex items-center gap-3">
        <div className="relative">
          <img 
            src={`https://openweathermap.org/img/wn/${weather.icon}@2x.png`} 
            alt={weather.description}
            className="w-10 h-10 drop-shadow-[0_0_5px_rgba(255,255,255,0.5)]"
          />
        </div>
        <div className="flex flex-col">
          <span className="text-xl font-black text-white leading-none">{weather.temp}°C</span>
          <span className="text-[10px] text-gray-400 uppercase font-bold tracking-tighter truncate w-24">
            {weather.city}
          </span>
        </div>
      </div>
      
      <div className="mt-2 border-t border-white/10 pt-2">
        <p className="text-[9px] text-red-500 font-black uppercase tracking-widest leading-tight">
          {weather.description}
        </p>
        {weather.main === 'Clear' && (
          <p className="text-[8px] text-white/70 font-medium mt-1 leading-tight animate-pulse">
            ¡Día brillante para ver contenido!
          </p>
        )}
      </div>
    </div>
  );
};

export default WeatherWidget;
