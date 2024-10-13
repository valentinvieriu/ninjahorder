import { ref, onMounted } from 'vue'

export function useRandomGradient() {
  const gradientStyle = ref('')

  const generateRandomColor = () => {
    return `hsl(${Math.random() * 360}, 70%, 80%)`
  }

  const generateGradient = () => {
    const color1 = generateRandomColor()
    const color2 = generateRandomColor()
    const color3 = generateRandomColor()
    return `linear-gradient(135deg, ${color1}, ${color2}, ${color3})`
  }

  onMounted(() => {
    gradientStyle.value = generateGradient()
  })

  return { gradientStyle }
}

